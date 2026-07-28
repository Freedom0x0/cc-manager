import { useState, useEffect } from 'react';
import { api } from '../api';
import type { SearchHit } from '../types';

export type TimeRange = 'today' | '7d' | '30d' | 'all';

function computeTimeRange(range: TimeRange): { from: number | null; to: number | null } {
  if (range === 'all') return { from: null, to: null };
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (range === 'today') return { from: now - day, to: now };
  if (range === '7d') return { from: now - 7 * day, to: now };
  return { from: now - 30 * day, to: now };
}

export function useSearch(query: string, projectIds: number[] | null, timeRange: TimeRange) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setSearched(false);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const { from, to } = computeTimeRange(timeRange);
        const result = await api.searchMessages(query, projectIds, from, to);
        setHits(result);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, projectIds?.join(','), timeRange]);

  return { hits, loading, searched };
}
