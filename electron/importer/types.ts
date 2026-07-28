export interface RawMessage {
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAtMs: number;
  projectPath: string;
}
