/**
 * Rule Catalogue Loader
 *
 * `rules/mplads_rules.yaml` is the single source for rule IDs, thresholds and
 * verification tiers (doctrine #5). This module does nothing but read and cache
 * it.
 *
 * It exists as its own file because the loader had grown a dependency cycle
 * around it: the catalogue now declares the fund-flow regimes as well as the
 * rules, so `services/fund_flow.ts` needs to read it — and `rule_engine.ts`, its
 * previous home, needs `fund_flow.ts` for the payment-history rules. ESM would
 * resolve that cycle by hoisting, which is to say it would work until someone
 * added a top-level constant to either file. A leaf module both can import
 * removes the question.
 */

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RulesConfig } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _cachedConfig: RulesConfig | null = null;

export function loadRulesConfig(): RulesConfig {
  if (!_cachedConfig) {
    const yamlPath = resolve(__dirname, '..', 'rules', 'mplads_rules.yaml');
    const content = readFileSync(yamlPath, 'utf-8');
    _cachedConfig = parse(content) as RulesConfig;
  }
  return _cachedConfig;
}
