import { initiateCheckout, verifyStatus } from './hubtelClient'

const realFetch = global.fetch

function mockFetchOnce(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: 'OK',
    text: async () => text,
  })
}

beforeAll(() => {
  process.env.HUBTEL_API_KEY = 'test-key'
  process.env.HUBTEL_ACCOUNT_ID = 'test-account'
  process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER = '11684'
})

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = realFetch
})

describe('initiateCheckout', () => {
  it('posts a well-formed request and returns the checkout URLs', async () => {
    mockFetchOnce({
      responseCode: '0000',
      status: 'Success',
      data: {
        checkoutId: 'chk_1',
        checkoutUrl: 'https://pay.hubtel.com/chk_1',
        checkoutDirectUrl: 'https://pay.hubtel.com/chk_1/direct',
        clientReference: 'CAMP_1',
      },
    })

    const result = await initiateCheckout({
      amountGHS: 5000.5,
      description: 'Camp payment',
      reference: 'CAMP_1',
      callbackUrl: 'https://fn/hubtelPaymentCallback',
      returnUrl: 'https://app/pay/return',
    })

    expect(result.checkoutId).toBe('chk_1')
    expect(result.checkoutDirectUrl).toBe('https://pay.hubtel.com/chk_1/direct')

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('https://payproxyapi.hubtel.com/items/initiate')
    expect(opts.method).toBe('POST')
    const expectedAuth =
      'Basic ' + Buffer.from('test-account:test-key').toString('base64')
    expect(opts.headers.Authorization).toBe(expectedAuth)
    const sent = JSON.parse(opts.body)
    expect(sent.clientReference).toBe('CAMP_1')
    expect(sent.totalAmount).toBe(5000.5) // 2dp GHS, no pesewas conversion
    expect(sent.merchantAccountNumber).toBe('11684')
  })

  it('throws when Hubtel returns a non-success response code', async () => {
    mockFetchOnce({ responseCode: '4000', status: 'Failed', message: 'Validation error' })
    await expect(
      initiateCheckout({
        amountGHS: 10,
        description: 'x',
        reference: 'R',
        callbackUrl: 'cb',
        returnUrl: 'rt',
      }),
    ).rejects.toThrow('Validation error')
  })
})

describe('verifyStatus', () => {
  it('maps a Paid status to SUCCESS with the GHS amount', async () => {
    mockFetchOnce({
      message: 'Successful',
      responseCode: '0000',
      data: {
        status: 'Paid',
        transactionId: 'txn_1',
        clientReference: 'CAMP_1',
        amount: 0.1,
        charges: 0.02,
        paymentMethod: 'mobilemoney',
      },
    })

    const result = await verifyStatus('CAMP_1')
    expect(result.status).toBe('SUCCESS')
    expect(result.amountGHS).toBe(0.1)
    expect(result.transactionId).toBe('txn_1')
    expect(result.channel).toBe('mobilemoney')
  })

  it('maps an Unpaid status to PENDING', async () => {
    mockFetchOnce({ responseCode: '0000', data: { status: 'Unpaid', amount: 0.1 } })
    const result = await verifyStatus('CAMP_1')
    expect(result.status).toBe('PENDING')
  })

  it('treats an unreadable body as PENDING (never falsely Paid)', async () => {
    mockFetchOnce({ responseCode: '0000', data: {} })
    const result = await verifyStatus('CAMP_1')
    expect(result.status).toBe('PENDING')
    expect(result.amountGHS).toBe(0)
  })
})
