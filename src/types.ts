export type Party = "原告" | "被告" | "审判庭";
export type EvidenceStatus = "待展示" | "展示中" | "已展示" | "已跳过" | "退回待复核";
export type SessionPhase = "开庭" | "举证" | "质证" | "休庭" | "结束";
export type Role = "书记员" | "审判长" | "代理人";
export type TimelineCategory = "庭审" | "保管交接";

/** 交接动作（卷宗保管台账） */
export type HandoverType =
  | "入库"
  | "外借"
  | "归还"
  | "现场换袋"
  | "回执登记"
  | "重新封存"
  | "库位转移"
  | "封条检查"
  | "条目核对";

export interface HandoverEvent {
  id: string;
  time: string;
  type: HandoverType;
  custodian: string;
  detail: string;
  /** 现场换袋后补传的回执编号；未补回执前为空 */
  receiptNo?: string;
}

export interface CustodyRecord {
  evidenceId: string;
  sealNo: string;
  sealIntact: boolean;
  location: string;
  custodian: string;
  /** 外借去向；在库时为 null */
  loanedTo: string | null;
  loanedAt: string | null;
  /** 最近一次交接记录 id，需与证据条目记录的交接点一致 */
  lastHandoverId: string;
  handovers: HandoverEvent[];
  /** 现场换袋后等待回执 */
  awaitingReceipt: boolean;
  sealNote: string;
}

export type BlockReason =
  | "外借未归还"
  | "封条破损"
  | "现场换袋无回执"
  | "封条编号不一致"
  | "存放位置不一致"
  | "交接记录不一致";

export interface GateVerdict {
  decision: "放行" | "拦下";
  reasons: BlockReason[];
}

export interface Clearance {
  id: string;
  evidenceId: string;
  batchId: string;
  attempt: number;
  decision: "放行" | "拦下";
  reasons: BlockReason[];
  at: string;
  /** 结论所依据的最近交接记录；回执更新后据此判定旧结论失效 */
  handoverId: string;
  /** 回执登记后旧结论失效，需要按同批次重新核对 */
  stale: boolean;
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
  /** 条目登记的封条编号、存放位置与最近交接记录（对账基准） */
  sealNo: string;
  location: string;
  handoverId: string;
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
  category: TimelineCategory;
}

export interface SessionState {
  phase: SessionPhase;
  currentEvidenceId: string | null;
  timerSeconds: number;
  operatorMode: "庭审控制" | "公开屏预览";
  role: Role;
}
