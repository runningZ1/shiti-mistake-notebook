import type { Analysis } from "./ai";
import type { OcrPage } from "./baidu-ocr";

export type SavedMistake = Analysis["mistakes"][number] & {
  id: string; uploadId: string; subject: string; sourceName: string; createdAt: string;
  reflection: string; similarQuestions: Array<{ question: string; answer: string; explanation: string }>;
  archiveKind?: 'mistake' | 'collection'; judgementSource?: string;
};
export type UploadSummary = {
  id: string; subject: string; fileNames: string[]; createdAt: string;
  status: "processing" | "completed" | "failed";
  hasAnalysis: boolean; questionCount: number | null; uncertainCount: number | null;
  mistakeCount: number; error: string | null; canRetry: boolean;
  title: string; homeworkDate: string | null; gradeLevel: string; intent: 'marked' | 'check' | 'collect';
  pendingCount: number; profileId: string;
};
export type UploadDetail = UploadSummary & {
  analysis: Omit<Analysis, "mistakes"> | null;
  ocrPages: OcrPage[]; mistakes: SavedMistake[];
  questions: import('./question-types').ConfirmedQuestion[];
  jobs: Array<{id:string;kind:string;status:string;error:string|null}>;
};
