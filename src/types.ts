export interface Campaign {
  id: string;
  name: string;
  subject: string;
  description: string | null;
  contentType: 'html' | 'text';
  htmlContent: string | null;
  textContent: string | null;
  status: string;
  recipientFilter: string | null;
  totalRecipients: number | null;
  sentCount: number;
  failedCount: number;
  openedCount: number;
  clickedCount: number;
  isTest: number;
  startedAt: number | null;
  completedAt: number | null;
  createdBy: string | null;
  sentBy: string | null;
  lastError: string | null;
  sendGeneration: number;
  createdAt: number;
  updatedAt: number;
}

export interface SendLog {
  id: string;
  campaignId: string;
  recipientEmail: string;
  recipientName: string | null;
  status: string;
  error: string | null;
  sentBy: string | null;
  openedAt: number | null;
  clickedAt: number | null;
  createdAt: number;
}

export interface Me {
  email: string;
  isSuperAdmin: boolean;
  canSend: boolean;
  senderEmail: string | null;
  senderName: string | null;
  resendApiKey: string | null;
}

export interface SendChunkResult {
  done: boolean;
  completed: boolean;
  generation: number;
  sentCount?: number;
  failedCount?: number;
  totalRecipients?: number;
  error?: string;
}
