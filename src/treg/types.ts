type TregFlags = {
  budget: number;
  metadata?: boolean;
  requestId?: string;
};

type TregMetadata = {
  endpoint: string;
  requestId: string;
  callId: string | null;
  sourceProvider: string | null;
  providerCostUsd: number | null;
};

type TregResponse = {
  data: Record<string, unknown>;
  metadata: TregMetadata;
};

export type { TregFlags, TregMetadata, TregResponse };
