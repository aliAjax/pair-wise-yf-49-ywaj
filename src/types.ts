export type Party = "原告" | "被告" | "审判庭";
export type EvidenceStatus = "待展示" | "展示中" | "已展示" | "已跳过" | "退回待复核";
export type SessionPhase = "开庭" | "举证" | "质证" | "休庭" | "结束";
export type Role = "书记员" | "审判庭" | "代理人";

/** 封条状态 */
export type SealStatus = "完好" | "破损";
/** 交接类型 */
export type HandoverType = "入库" | "外借" | "归还" | "换袋";
/** 回执状态 */
export type ReceiptStatus = "有回执" | "无回执";

/** 交接记录（保管人姓名、封条说明为敏感信息，仅书记员/审判庭可见） */
export interface HandoverRecord {
  id: string;
  evidenceId: string;
  time: string;
  type: HandoverType;
  /** 保管人姓名 —— 敏感，不进公开屏、不对代理人展示 */
  custodian: string;
  /** 交接时登记的封条编号 */
  sealNo: string;
  /** 交接时登记的存放位置 */
  location: string;
  sealStatus: SealStatus;
  receiptStatus: ReceiptStatus;
  /** 封条说明 —— 敏感，不进公开屏、不对代理人展示 */
  sealNote: string;
}

/** 卷宗保管台账条目 */
export interface CustodyRecord {
  evidenceId: string;
  /** 当前封条编号（台账实际值） */
  sealNo: string;
  /** 当前存放位置（台账实际值） */
  location: string;
  sealStatus: SealStatus;
  handovers: HandoverRecord[];
}

/** 放行结论 */
export type ReleaseStatus = "放行" | "拦下" | "退回待复核" | "失效";

/** 放行记录（同一批次可包含多次核对结论） */
export interface ReleaseRecord {
  id: string;
  /** 批次号：核对失败后保留原批次，按同一批次重试 */
  batchNo: string;
  evidenceId: string;
  status: ReleaseStatus;
  time: string;
  /** 拦下 / 退回原因 */
  reasons: string[];
  /** 核对时快照：封条编号 */
  sealNo: string;
  /** 核对时快照：存放位置 */
  location: string;
}

export interface Evidence {
  id: string;
  exhibitNo: string;
  title: string;
  type: "书证" | "物证" | "电子数据" | "证人";
  duration: number;
  presenter: Party;
  sensitive: boolean;
  status: EvidenceStatus;
  note: string;
  /** 证据条目登记的封条编号（与台账对账用） */
  sealNo: string;
  /** 证据条目登记的存放位置（与台账对账用） */
  location: string;
}

export interface Objection {
  id: string;
  evidenceId: string;
  ground: string;
  explanation: string;
  status: "待裁定" | "支持" | "驳回";
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  time: string;
  actor: Party | "书记员";
  action: string;
  detail: string;
}

export interface SessionState {
  phase: SessionPhase;
  currentEvidenceId: string | null;
  timerSeconds: number;
  operatorMode: "庭审控制" | "公开屏预览";
}
