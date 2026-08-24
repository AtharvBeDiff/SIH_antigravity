/**
 * Rules Router — GET /rules, GET /rules/:ruleId
 */

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from '../db.ts';
import { notFound } from '../http.ts';
import type { RulesConfig, RuleProbation } from '../types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRules(): RulesConfig {
  const yamlPath = resolve(__dirname, '..', 'rules', 'mplads_rules.yaml');
  const content = readFileSync(yamlPath, 'utf-8');
  return parse(content) as RulesConfig;
}

const router = Router();

/** GET /rules — list all rules with verification status and probation */
router.get('/', async (_req, res) => {
  const config = loadRules();
  const rules = await Promise.all(
    config.rules.map(async (rule) => {
      const probation = await get<RuleProbation>('rule_probation', { rule_id: rule.id });
      return {
        ...rule,
        probation: probation ?? {
          rule_id: rule.id,
          total_reviews: 0,
          dismissals: 0,
          actionable_rate: 1.0,
          suspended: false,
          suspended_at: null,
          reinstated_at: null,
        },
      };
    }),
  );
  res.json({
    data: {
      rules,
      probation_config: config.probation,
      alert_budget: config.alert_budget,
    },
  });
});

/** GET /rules/:ruleId — single rule detail */
router.get('/:ruleId', async (req, res) => {
  const config = loadRules();
  const rule = config.rules.find(r => r.id === req.params['ruleId']);
  notFound(rule, 'Rule', req.params['ruleId'] ?? '');

  const probation = await get<RuleProbation>('rule_probation', { rule_id: rule.id });

  res.json({
    data: {
      ...rule,
      probation: probation ?? {
        rule_id: rule.id,
        total_reviews: 0,
        dismissals: 0,
        actionable_rate: 1.0,
        suspended: false,
      },
    },
  });
});

export default router;
