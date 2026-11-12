export type ConfirmedQuestion = {
  id: string; uploadId: string; pageNumber: number; sourceIndex: number | null;
  originalOcr: unknown; version: number; question: string; studentAnswer: string;
  referenceAnswer: string; referenceSource: string; bounds: number[];
  state: 'pending' | 'confirmed' | 'ignored'; hasFigure: boolean;
  archiveId: string | null; archiveKind: 'mistake' | 'collection' | null;
  report: {verdict: 'correct' | 'incorrect' | 'uncertain' | 'unanswered'; comment: string; correctAnswer?: string; reasoning?: string; knowledgePoint?: string} | null;
  reportVersion: number | null; reportStale: boolean;
};
export const subjectNames = ['数学','语文','英语','物理','化学','生物','历史','地理','道德与法治','科学','其他'];
export function normalizeSubject(value: string) {
  const clean = value.trim();
  return subjectNames.find(name => clean.includes(name)) || (clean === '政治' ? '道德与法治' : '其他');
}
