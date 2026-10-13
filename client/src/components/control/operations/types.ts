import type {
  AttentionItem,
  OperationsAttention,
  OperationsHealth,
} from "@shared/operationsDashboard";

export type ReadFilter = "all" | "unread" | "read";
export type KindFilter = "all" | "failed" | "completed";

export interface AdminNotification {
  id: string;
  runId?: string | null;
  kind?: string | null;
  title: string;
  body: string;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  items?: AdminNotification[];
  notifications?: AdminNotification[];
  unreadCount: number;
  limit: number;
}

export interface ResourceState<T> {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
}

export type HealthResource = ResourceState<OperationsHealth>;
export type AttentionResource = ResourceState<OperationsAttention>;
export type SafeAttentionItem = AttentionItem;
