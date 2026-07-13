export type RecipientFilter =
  | { type: 'all' }
  | { type: 'active'; days: number }
  | { type: 'plan_starter' }
  | { type: 'plan_standard' }
  | { type: 'plan_advanced' }
  | { type: 'manual'; emails: string[] };

export interface RecipientFlags {
  recipients?: string;
  days?: string;
  emails?: string;
}

const VALID_TYPES = ['all', 'active', 'plan_starter', 'plan_standard', 'plan_advanced', 'manual'] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipientFilter(flags: RecipientFlags): RecipientFilter {
  if (!flags.recipients) {
    throw new Error('--recipients is required (one of: all, active, plan_starter, plan_standard, plan_advanced, manual)');
  }
  if (!(VALID_TYPES as readonly string[]).includes(flags.recipients)) {
    throw new Error(`Invalid --recipients value "${flags.recipients}" (must be one of: ${VALID_TYPES.join(', ')})`);
  }
  const type = flags.recipients as (typeof VALID_TYPES)[number];

  if (type === 'active') {
    const days = flags.days ? Number(flags.days) : 30;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error('--days must be an integer between 1 and 365');
    }
    return { type: 'active', days };
  }

  if (type === 'manual') {
    const emails = (flags.emails ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) {
      throw new Error('--emails is required and must be non-empty when --recipients manual');
    }
    for (const email of emails) {
      if (!EMAIL_PATTERN.test(email)) {
        throw new Error(`Invalid email address in --emails: "${email}"`);
      }
    }
    return { type: 'manual', emails };
  }

  return { type } as RecipientFilter;
}

export function filterToQuery(filter: RecipientFilter): string {
  const params = new URLSearchParams({ type: filter.type });
  if (filter.type === 'active') params.set('days', String(filter.days));
  if (filter.type === 'manual') params.set('emails', filter.emails.join(','));
  return params.toString();
}
