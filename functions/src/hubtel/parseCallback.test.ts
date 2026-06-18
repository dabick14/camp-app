import { parseCallback } from './parseCallback'
import type { HubtelCallbackPayload } from './types'

// The exact callback shape from the Hubtel Online Checkout docs.
const sampleCallback: HubtelCallbackPayload = {
  ResponseCode: '0000',
  Status: 'Success',
  Data: {
    CheckoutId: '59e2fbbff4e443b98e09346881ac7e9a',
    SalesInvoiceId: 'e96ccfb4746045bba13f425bd573a31c',
    ClientReference: 'CAMP_ABC_123',
    Status: 'Success',
    Amount: 0.5,
    CustomerPhoneNumber: '233242825109',
    PaymentDetails: {
      MobileMoneyNumber: '233242825109',
      PaymentType: 'mobilemoney',
      Channel: 'mtn-gh',
    },
    Description: 'Approved',
  },
}

describe('parseCallback', () => {
  it('parses a successful PascalCase callback', () => {
    const parsed = parseCallback(sampleCallback)
    expect(parsed).not.toBeNull()
    expect(parsed!.reference).toBe('CAMP_ABC_123')
    expect(parsed!.checkoutId).toBe('59e2fbbff4e443b98e09346881ac7e9a')
    expect(parsed!.amountGHS).toBe(0.5) // GHS, not pesewas
    expect(parsed!.status).toBe('SUCCESS')
    expect(parsed!.senderPhone).toBe('+233242825109')
    expect(parsed!.channel).toBe('mobilemoney')
    expect(parsed!.channelProvider).toBe('mtn-gh')
  })

  it('tolerates a camelCase payload', () => {
    const parsed = parseCallback({
      data: { clientReference: 'REF1', status: 'Success', amount: 12.5 },
    } as unknown as HubtelCallbackPayload)
    expect(parsed!.reference).toBe('REF1')
    expect(parsed!.amountGHS).toBe(12.5)
    expect(parsed!.status).toBe('SUCCESS')
  })

  it('returns null when there is no Data block', () => {
    expect(parseCallback({ ResponseCode: '0000' })).toBeNull()
  })

  it('returns null when there is no client reference', () => {
    expect(parseCallback({ Data: { Amount: 1 } })).toBeNull()
  })

  it('maps a failed status', () => {
    const parsed = parseCallback({
      Data: { ClientReference: 'REF2', Status: 'Failed', Amount: 5 },
    })
    expect(parsed!.status).toBe('FAILED')
  })
})
