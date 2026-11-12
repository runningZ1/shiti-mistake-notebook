import type { PracticeGrade } from './practice-types';
import type { KnowledgeEvidence } from './knowledge-map';
export type LearningEvidenceRound = {
 id:string; paperId:string; subject:string; unitName:string; answers:string[]; grading:PracticeGrade[];
 questions:Array<{question:string;knowledgePoint:string}>;
 source:string; sourceId:string|null; status:string; gradingSource:string|null;
 startedAt:string; completedAt:string|null; error:string|null; legacy:boolean;
};
export type LearningEvidenceResponse = {profileId:string; attempts:LearningEvidenceRound[]; legacyPapers:LearningEvidenceRound[]; limit:number; truncated:boolean; error?:string};
/** Each attempt is a distinct source. Unassessed, blank and unfinished answers never count as correct/wrong evidence. */
export function roundKnowledgeEvidence(rounds:LearningEvidenceRound[]):KnowledgeEvidence[] {
 return rounds.flatMap(round=>round.status!=='completed'||round.gradingSource==='unassessed'?[]:round.grading.flatMap(grade=>{
  if(!round.answers[grade.index]?.trim()||!['correct','incorrect'].includes(grade.verdict))return [];
  return [{id:`${round.id}:${grade.index}`,subject:round.subject,knowledgePoint:grade.knowledgePoint,
   sourceId:round.id,source:grade.verdict==='correct'?'practice_correct' as const:'practice' as const,createdAt:round.completedAt||round.startedAt}];
 }));
}
