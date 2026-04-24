export interface ParsedTradeUrl {
  partnerId: string;
  token: string;
  valid: boolean;
  error?: string;
}

const TRADE_URL_REGEX = /tradeoffer\/new\/\?partner=(\d+)&token=([a-zA-Z0-9_-]+)/;

export class TradeUrlParseError extends Error {
  public readonly url: string;
  public readonly reason: string;

  constructor(url: string, reason: string) {
    super(`Invalid trade URL: ${reason}`);
    this.name = 'TradeUrlParseError';
    this.url = url;
    this.reason = reason;
  }
}

export function parseTradeUrl(url: string): ParsedTradeUrl {
  if (!url || typeof url !== 'string') {
    return { partnerId: '', token: '', valid: false, error: 'Trade URL is required' };
  }

  const match = url.trim().match(TRADE_URL_REGEX);
  if (!match) {
    return {
      partnerId: '',
      token: '',
      valid: false,
      error: 'Expected https://steamcommunity.com/tradeoffer/new/?partner=XXX&token=XXX',
    };
  }

  const [, partnerId, token] = match;
  const partnerIdNum = parseInt(partnerId, 10);
  if (isNaN(partnerIdNum) || partnerIdNum <= 0) {
    return { partnerId: '', token: '', valid: false, error: 'Invalid partner ID' };
  }
  if (token.length < 6 || token.length > 12) {
    return { partnerId, token, valid: false, error: 'Invalid token length' };
  }

  return { partnerId, token, valid: true };
}

export function validateTradeUrl(url: string): boolean {
  return parseTradeUrl(url).valid;
}

export function parseTradeUrlStrict(url: string): ParsedTradeUrl {
  const result = parseTradeUrl(url);
  if (!result.valid) throw new TradeUrlParseError(url, result.error || 'Unknown error');
  return result;
}

const STEAM64_BASE = BigInt('76561197960265728');

export function partnerIdToSteam64(partnerId: string | number): string {
  const accountId = typeof partnerId === 'string' ? parseInt(partnerId, 10) : partnerId;
  if (isNaN(accountId) || accountId <= 0) throw new Error('Invalid partner ID');
  return (STEAM64_BASE + BigInt(accountId)).toString();
}

export function steam64ToPartnerId(steam64Id: string | bigint): string {
  const steam64 = typeof steam64Id === 'string' ? BigInt(steam64Id) : steam64Id;
  if (steam64 < STEAM64_BASE) throw new Error('Invalid Steam64 ID');
  return (steam64 - STEAM64_BASE).toString();
}

export function buildTradeUrl(partnerId: string | number, token: string): string {
  return `https://steamcommunity.com/tradeoffer/new/?partner=${partnerId}&token=${token}`;
}
