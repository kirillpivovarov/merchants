export type Risk = "normal" | "attention" | "alarm" | "critical";
export interface Evidence {
  url: string;
  quote: string;
  capturedAt: string;
}
export interface Check {
  id: string;
  group: string;
  title: string;
  status: string;
  weight: number;
  result: string;
  evidence: Evidence[];
}
export interface Scan {
  id: string;
  merchantId: string;
  score: number;
  risk: Risk;
  completeness: string;
  violations: number;
  createdAt: string;
  mode: string;
  checks: Check[];
  pages: { url: string; title: string }[];
  extracted: { identifiers: string[]; payment: string[]; emails: string[] };
  engineVersion: string;
}
export interface Merchant {
  id: string;
  name: string;
  url: string;
  inn: string;
  mcc: string;
  interval: number;
  monitoring: boolean;
  nextScanAt: string;
  latest?: Scan;
  demoProfile?: string;
}
export interface DictionaryEntry {
  id: string;
  term: string;
  category: string;
  weight: number;
  enabled: boolean;
}
export interface Review {
  verdict: string;
  note: string;
  actor: string;
  at: string;
}
export interface AppState {
  merchants: Merchant[];
  scans: Scan[];
  dictionary: DictionaryEntry[];
  reviews: Record<string, Review>;
  audit: {
    id: string;
    action: string;
    entity: string;
    at: string;
    actor: string;
  }[];
  settings: { scheduleEnabled: boolean };
  summary: {
    rows: Merchant[];
    total: number;
    scanned: number;
    partial: number;
    unscanned: number;
    findings: number;
    risks: Record<Risk, number>;
  };
  capabilities: { live: boolean; scheduler: boolean };
  actor: string;
}
