import { Inject, Injectable } from "@nestjs/common"
import { UnknownFieldError } from "../errors.js"
import { MetadataService } from "../metadata/metadata.service.js"
import type { Layout } from "./layout-specs.js"

/* R1·UP-3 版面讀寫(業務層)。setLayout 驗 layout.fields 之 key ⊆ 該 form 現存 field_def id
   (防引用他表/已刪欄)+ tenant scope(承 MetadataService);純 metadata,零 DDL。 */
@Injectable()
export class LayoutService {
  constructor(@Inject(MetadataService) private readonly metadata: MetadataService) {}

  async getLayout(tenantId: number, formId: number): Promise<unknown> {
    const { form } = await this.metadata.getForm(tenantId, formId)
    return form.layout
  }

  async setLayout(
    tenantId: number,
    formId: number,
    layout: Layout,
  ): Promise<Layout & { version: number }> {
    const { fields } = await this.metadata.getForm(tenantId, formId)
    const validIds = new Set(fields.map((f) => String(f.id)))
    for (const key of Object.keys(layout.fields)) {
      if (!validIds.has(key)) throw new UnknownFieldError(`layout field id ${key}`)
    }
    const version = await this.metadata.setLayout(
      tenantId,
      formId,
      layout,
      layout.expectedVersion,
    )
    return { ...layout, version }
  }
}
