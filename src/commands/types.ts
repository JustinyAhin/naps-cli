type SeoResearchFlags = {
  location?: string;
  language?: string;
  refresh?: boolean;
  budget?: number;
  metadata?: boolean;
};

type SeoBulkFlags = SeoResearchFlags & { requestId?: string };

export type { SeoResearchFlags, SeoBulkFlags };
