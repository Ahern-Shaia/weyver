import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

/* 🔴 R1·A-1 M4 / OQ-SC-6=A|第三方憑證的應用層加密(信封式)。

   ## 為什麼是加密而不是雜湊

   自家 API 金鑰(G-1)存的是**雜湊**,因為驗證只需要比對。
   但 LINE channel access token / Slack webhook URL / SMTP 密碼**必須還原成明文
   才能拿去呼叫第三方** —— 雜湊在這裡不是「更安全的選項」,是**做不到**。

   ## 為什麼是應用層而不是 DB/磁碟層

   OWASP Cryptographic Storage Cheat Sheet 對層級**不選邊**,但給了判準:
   「**Which layer(s) are most appropriate will depend on the threat model.**
   For example, hardware level encryption is effective at protecting against the
   physical theft of the server, but will provide no protection if an attacker is
   able to compromise the server remotely.」

   本專案的主威脅是**應用被打穿 / RLS 被繞過**(特權連線遮蔽安全機制已踩過七次),
   那正是 TDE 擋不住的 → 應用層。

   ## 為什麼是信封(envelope)

   同一份 Cheat Sheet:「The Data Encryption Key (DEK) is used to encrypt the data.
   The Key Encryption Key (KEK) is used to encrypt the DEK.」
   好處是**輪替 KEK 不必碰明文**:只要把每筆的 wrapped DEK 解開再用新 KEK 包回去。
   HashiCorp Vault 的 transit rewrap 即是此模式,官方逐字「**does not reveal the
   plaintext data**」。直接用 KEK 加密全部資料的話,輪替就得把每一筆解密再加密,
   等於讓所有明文在輪替當下一次全部出現在記憶體裡。

   演算法:AES-256-GCM(同 Cheat Sheet:「authenticated modes should always be
   used… **GCM** and **CCM**, which should be used as a first preference」)。 */

const ALGO = "aes-256-gcm"
const DEK_BYTES = 32
const IV_BYTES = 12 // GCM 標準 96-bit nonce

/* 版本前綴讓格式可演進:日後換演算法時,舊資料仍解得開(靠這個字元分派)。 */
const FORMAT_V1 = "v1"

export interface SealedSecret {
  /* 自我描述的單一字串,方便存成一個 text 欄位。
     `v1.<kekId>.<wrappedDek>.<dekIv>.<dekTag>.<iv>.<tag>.<ciphertext>`,各段 base64url。 */
  readonly sealed: string
  /* 🔴 指紋 = 明文的 SHA-256 前 8 bytes。用途只有一個:讓稽核與 UI 能說
     「這次換的值和上次不同」,而**不必存或回顯明文**。
     不可逆,且對高熵憑證(token / webhook URL)無字典攻擊價值。 */
  readonly fingerprint: string
}

function kekFrom(kekMaterial: string): Buffer {
  /* KEK 由 env 提供,以 SHA-256 正規化成 32 bytes —— 允許營運端填任意長度的
     高熵字串,而不必逼他們產出剛好 32 bytes 的 base64。 */
  return createHash("sha256").update(kekMaterial, "utf8").digest()
}

const b64 = (b: Buffer): string => b.toString("base64url")
const unb64 = (s: string): Buffer => Buffer.from(s, "base64url")

export function sealSecret(plaintext: string, kekMaterial: string, kekId = "1"): SealedSecret {
  if (plaintext === "") throw new Error("不得加密空字串")
  const kek = kekFrom(kekMaterial)
  const dek = randomBytes(DEK_BYTES)

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, dek, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  const dekIv = randomBytes(IV_BYTES)
  const wrap = createCipheriv(ALGO, kek, dekIv)
  const wrappedDek = Buffer.concat([wrap.update(dek), wrap.final()])
  const dekTag = wrap.getAuthTag()

  return {
    sealed: [
      FORMAT_V1,
      kekId,
      b64(wrappedDek),
      b64(dekIv),
      b64(dekTag),
      b64(iv),
      b64(tag),
      b64(ciphertext),
    ].join("."),
    fingerprint: createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 16),
  }
}

export function openSecret(sealed: string, kekMaterial: string): string {
  const parts = sealed.split(".")
  const [version, , wrappedDek, dekIv, dekTag, iv, tag, ciphertext] = parts
  if (version !== FORMAT_V1 || parts.length !== 8) throw new Error("憑證格式無法辨識")
  if (
    wrappedDek === undefined ||
    dekIv === undefined ||
    dekTag === undefined ||
    iv === undefined ||
    tag === undefined ||
    ciphertext === undefined
  ) {
    throw new Error("憑證格式無法辨識")
  }

  const kek = kekFrom(kekMaterial)
  const unwrap = createDecipheriv(ALGO, kek, unb64(dekIv))
  unwrap.setAuthTag(unb64(dekTag))
  /* GCM 的驗證標籤在 `final()` 才檢查 —— 竄改過的密文會在這裡拋,
     這正是我們要的:**寧可解不開,也不要拿到一段被動過手腳的「明文」**。 */
  const dek = Buffer.concat([unwrap.update(unb64(wrappedDek)), unwrap.final()])

  const decipher = createDecipheriv(ALGO, dek, unb64(iv))
  decipher.setAuthTag(unb64(tag))
  return Buffer.concat([decipher.update(unb64(ciphertext)), decipher.final()]).toString("utf8")
}

/* KEK 輪替:解開 wrapped DEK,用新 KEK 包回去。**全程不觸碰明文**
   (承 Vault transit rewrap 的語意)。回傳新的 sealed 字串。 */
export function rewrapSecret(
  sealed: string,
  oldKek: string,
  newKek: string,
  newKekId: string,
): string {
  const parts = sealed.split(".")
  const [version, , wrappedDek, dekIv, dekTag, iv, tag, ciphertext] = parts
  if (version !== FORMAT_V1 || parts.length !== 8) throw new Error("憑證格式無法辨識")
  if (
    wrappedDek === undefined ||
    dekIv === undefined ||
    dekTag === undefined ||
    iv === undefined ||
    tag === undefined ||
    ciphertext === undefined
  ) {
    throw new Error("憑證格式無法辨識")
  }

  const unwrap = createDecipheriv(ALGO, kekFrom(oldKek), unb64(dekIv))
  unwrap.setAuthTag(unb64(dekTag))
  const dek = Buffer.concat([unwrap.update(unb64(wrappedDek)), unwrap.final()])

  const newIv = randomBytes(IV_BYTES)
  const wrap = createCipheriv(ALGO, kekFrom(newKek), newIv)
  const newWrapped = Buffer.concat([wrap.update(dek), wrap.final()])

  return [
    FORMAT_V1,
    newKekId,
    b64(newWrapped),
    b64(newIv),
    b64(wrap.getAuthTag()),
    iv,
    tag,
    ciphertext,
  ].join(".")
}
