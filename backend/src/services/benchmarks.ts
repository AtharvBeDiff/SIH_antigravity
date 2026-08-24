/**
 * Benchmarks Service
 *
 * Computes district-category medians and MAD (Median Absolute Deviation)
 * for cost benchmarking. Used by the cost outlier detector.
 */

import { all } from '../db.ts';
import { median, mad } from '../util.ts';
import type { Work } from '../types.ts';

export interface CategoryBenchmark {
  district_id: string;
  category: string;
  count: number;
  median_amount: number;
  mad_amount: number;
}

export async function computeBenchmarks(): Promise<Map<string, CategoryBenchmark>> {
  const works = await all<Work>('works');
  const groups = new Map<string, number[]>();

  for (const w of works) {
    if (typeof w.sanctioned_amount === 'number' && w.sanctioned_amount > 0 && w.district_id && w.category) {
      const key = `${w.district_id}::${w.category}`;
      const list = groups.get(key) ?? [];
      list.push(w.sanctioned_amount);
      groups.set(key, list);
    }
  }

  const benchmarks = new Map<string, CategoryBenchmark>();

  for (const [key, amounts] of groups.entries()) {
    const [district_id, category] = key.split('::') as [string, string];
    const med = median(amounts);
    const m = mad(amounts, med);
    benchmarks.set(key, {
      district_id,
      category,
      count: amounts.length,
      median_amount: med,
      mad_amount: m,
    });
  }

  return benchmarks;
}
