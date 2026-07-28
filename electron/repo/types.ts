export interface ProjectRow {
  id: number;
  path: string;
  name: string;
  sessionCount: number;
}

export interface SessionRow {
  id: number;
  sessionId: string;
  projectId: number;
  title: string | null;
  startedAt: number;
  lastMessageAt: number;
  messageCount: number;
  sourceFile: string;
  firstUserMessage: string | null;
}

export interface MessageRow {
  id: number;
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SearchHit {
  message: MessageRow;
  snippet: string;
  sessionTitle: string | null;
  projectName: string;
  projectId: number;
}

export interface ProjectTreeNode {
  id: number;
  name: string;
  path: string;
  sessionCount: number;
  children: ProjectTreeNode[];
}
