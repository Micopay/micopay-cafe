import { xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { resultCode } from '../src/stellar.js';

const result = (r: xdr.TransactionResultResult) =>
  new xdr.TransactionResult({ feeCharged: xdr.Int64.fromString('1000'), result: r, ext: new xdr.TransactionResultExt(0) }).toXDR('base64');

describe('código de un resultado de Stellar', () => {
  it('nombra la primera operación que falló', () => {
    const failed = xdr.TransactionResultResult.txFailed([
      xdr.OperationResult.opInner(xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess())),
      xdr.OperationResult.opInner(xdr.OperationResultTr.payment(xdr.PaymentResult.paymentUnderfunded())),
    ]);
    expect(resultCode(result(failed))).toBe('paymentUnderfunded');
  });

  it('sin operación fallida usa el código de la transacción', () => {
    expect(resultCode(result(xdr.TransactionResultResult.txBadSeq()))).toBe('txBadSeq');
  });

  it('un resultado ilegible no se confunde con un código', () => {
    expect(resultCode('no-es-xdr')).toBe('resultado ilegible');
  });
});
