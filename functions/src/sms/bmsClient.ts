// Low-level HTTP client for BMS Africa's SMS API — which is a white-labeled
// mnotify.com (BMS's docs at developer.bms.africa resolve to mnotify's
// OpenAPI spec, and BMS confirmed the two are the same provider). Talks
// directly to api.mnotify.com.
//
// Auth note: mnotify's OpenAPI securityScheme metadata declares the API key
// as a header (`api_key`), but every one of its own runnable code samples
// (curl/php/python/nodejs) instead passes it as a `?key=` query parameter.
// We follow the code samples — they're the concrete, working examples.

const BMS_QUICK_SMS_URL = 'https://api.mnotify.com/api/sms/quick'

export interface BmsSendResult {
  ok: boolean
  httpStatus: number
  raw: unknown
  creditLeft?: number
  errorMessage?: string
}

function extractCreditLeft(body: unknown): number | undefined {
  const summary = (body as { summary?: { credit_left?: unknown } } | null)?.summary
  return typeof summary?.credit_left === 'number' ? summary.credit_left : undefined
}

export async function sendQuickSms(params: {
  apiKey: string
  sender: string
  recipient: string // single local-format number, e.g. "0241234567"
  message: string
}): Promise<BmsSendResult> {
  const url = `${BMS_QUICK_SMS_URL}?key=${encodeURIComponent(params.apiKey)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: [params.recipient],
        sender: params.sender,
        message: params.message,
        is_schedule: false,
        schedule_date: '',
      }),
    })
  } catch (err) {
    return { ok: false, httpStatus: 0, raw: null, errorMessage: (err as Error).message }
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Non-JSON response body — raw stays null, errorMessage falls back below.
  }

  const creditLeft = extractCreditLeft(body)
  const status = (body as { status?: string } | null)?.status

  if (!res.ok || status !== 'success') {
    const message = (body as { message?: string } | null)?.message
    return {
      ok: false,
      httpStatus: res.status,
      raw: body,
      creditLeft,
      errorMessage: message ?? `HTTP ${res.status}`,
    }
  }

  return { ok: true, httpStatus: res.status, raw: body, creditLeft }
}
