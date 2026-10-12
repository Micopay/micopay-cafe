import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateXML } from 'xmllint-wasm';
import {
  buildCamt053, buildCamt054, buildPain001, buildPain002, shortRef,
  type Entry, type Party, type PaymentRun, type SettlementInfo,
} from '../src/index.js';

const XSD_DIR = fileURLToPath(new URL('../../../docs/xsd/', import.meta.url));

async function expectValid(xml: string, schema: string) {
  const result = await validateXML({
    xml: { fileName: 'message.xml', contents: xml },
    schema: { fileName: `${schema}.xsd`, contents: readFileSync(`${XSD_DIR}${schema}.xsd`, 'utf8') },
  });
  expect(result.errors.map((e) => e.rawMessage)).toEqual([]);
  expect(result.valid).toBe(true);
}

const COOP: Party = {
  name: 'Cooperativa Cafetalera Tzeltal',
  account: { id: 'COOP-0001', stellarAddress: 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG' },
};
const JUAN: Party = {
  name: 'Juan Pérez López',
  account: { id: 'PROD-0042', stellarAddress: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON' },
};
const SETTLEMENT: SettlementInfo = {
  network: 'TESTNET',
  assetCode: 'MXNe',
  assetIssuer: 'GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG',
};
const UETR = '3f2b8c1e-7a4d-4e9b-9c21-5d8e0f6a1b2c';
const NOW = new Date('2026-11-14T15:30:00Z');

function run(): PaymentRun {
  return {
    msgId: shortRef('PAIN', NOW),
    createdAt: NOW,
    initiatingParty: COOP.name,
    pmtInfId: shortRef('RUN', NOW),
    executionDate: NOW,
    debtor: COOP,
    currency: 'MXN',
    settlement: SETTLEMENT,
    transactions: [
      {
        instrId: shortRef('INS', NOW),
        endToEndId: shortRef('E2E', NOW),
        uetr: UETR,
        amount: '15400.00',
        creditor: JUAN,
        document: {
          number: 'ENT-2026-000123',
          date: NOW,
          lines: [{ id: 'LOTE-45', description: 'Café pergamino · 250.00 kg × 85.00 MXN/kg', amount: '21250.00' }],
          duePayable: '21250.00',
          adjustments: [
            { amount: '850.00', reason: 'HUME', info: 'Castigo por humedad 13.5%' },
            { amount: '5000.00', reason: 'CRED', info: 'Abono crédito CR-2026-0012' },
          ],
          remitted: '15400.00',
        },
      },
    ],
  };
}

function entry(direction: 'CRDT' | 'DBIT', value: string): Entry {
  return {
    amount: value, direction, bookedAt: NOW, endToEndId: 'E2E-20261114-ABCDEFGHJK', uetr: UETR,
    debtor: COOP, creditor: JUAN, remittance: 'Liquidación ENT-2026-000123 · 250 kg café pergamino',
    settlement: { ...SETTLEMENT, txHash: 'a'.repeat(64) },
  };
}

describe('mensajes contra los XSD oficiales', () => {
  it('pain.001 de una corrida con kilos, castigo y abono a crédito', async () => {
    await expectValid(buildPain001(run()), 'pain.001.001.09');
  });

  it('pain.002 aceptado y rechazado', async () => {
    const base = { originalInstrId: 'INS-20261114-ABCDEFGHJK', originalEndToEndId: 'E2E-20261114-ABCDEFGHJK', originalUetr: UETR, settlement: SETTLEMENT };
    const xml = buildPain002({
      msgId: shortRef('STS', NOW), createdAt: NOW, initiatingParty: COOP.name,
      originalMsgId: 'PAIN-20261114-ABCDEFGHJK', originalCreatedAt: NOW, originalPmtInfId: 'RUN-20261114-ABCDEFGHJK',
      entries: [
        { ...base, status: 'ACSC', settlement: { ...SETTLEMENT, txHash: 'b'.repeat(64) } },
        { ...base, originalUetr: '9a1b2c3d-1111-4222-8333-444455556666', status: 'RJCT', reasonCode: 'op_underfunded', reasonInfo: 'Saldo insuficiente' },
      ],
    });
    expect(xml).toContain('<GrpSts>PART</GrpSts>');
    await expectValid(xml, 'pain.002.001.10');
  });

  it('camt.054 recibo del productor (CRDT)', async () => {
    await expectValid(
      buildCamt054({ msgId: shortRef('NTF', NOW), notificationId: shortRef('N', NOW), createdAt: NOW, account: JUAN.account, accountOwner: JUAN.name, currency: 'MXN', entries: [entry('CRDT', '15400.00')] }),
      'camt.054.001.08',
    );
  });

  it('camt.053 de la cooperativa con cargos (DBIT) que concilian', async () => {
    await expectValid(
      buildCamt053({
        msgId: shortRef('STM', NOW), statementId: shortRef('S', NOW), createdAt: NOW,
        from: new Date('2026-11-14T00:00:00Z'), to: new Date('2026-11-14T23:59:59Z'),
        account: COOP.account, accountOwner: COOP.name, currency: 'MXN',
        openingBalance: '50000.00', closingBalance: '29600.00',
        entries: [entry('DBIT', '15400.00'), entry('DBIT', '5000.00')],
      }),
      'camt.053.001.08',
    );
  });
});

describe('reglas que el XSD no revisa', () => {
  it('rechaza un estado de cuenta que no concilia', () => {
    expect(() =>
      buildCamt053({
        msgId: 'M', statementId: 'S', createdAt: NOW, from: NOW, to: NOW, account: COOP.account, accountOwner: COOP.name,
        currency: 'MXN', openingBalance: '100.00', closingBalance: '100.00', entries: [entry('DBIT', '10.00')],
      }),
    ).toThrow(/no reconcile|does not reconcile/);
  });

  it('rechaza tokens como divisa', () => {
    expect(() => buildPain001({ ...run(), currency: 'USDC' })).toThrow(/ISO 4217/);
    expect(() => buildPain001({ ...run(), currency: 'XRP' })).toThrow(/ISO 4217/);
  });

  it('rechaza montos con decimales de más o en notación de punto flotante', () => {
    const r = run();
    r.transactions[0]!.amount = '15400.001';
    expect(() => buildPain001(r)).toThrow(/decimal/);
  });

  it('rechaza identificadores de más de 35 caracteres (un UUID mide 36)', () => {
    expect(() => buildPain001({ ...run(), msgId: UETR })).toThrow(/1-35/);
  });

  it('las referencias cortas caben en Max35Text', () => {
    expect(shortRef('PAIN').length).toBeLessThanOrEqual(35);
  });
});

describe('control negativo: el validador sí detecta errores', () => {
  const good = () => buildPain001(run());
  const tampered: Array<[string, (xml: string) => string]> = [
    ['CreDtTm después de NbOfTxs', (x) => x.replace(/(<CreDtTm>[^<]*<\/CreDtTm>)(\s*)(<NbOfTxs>1<\/NbOfTxs>)/, '$3$2$1')],
    ['elemento desconocido', (x) => x.replace('<CreDtTm>', '<Bogus/><CreDtTm>')],
    ['Ccy de 4 letras', (x) => x.replace('<InstdAmt Ccy="MXN">', '<InstdAmt Ccy="USDC">')],
    ['MsgId de 36 caracteres', (x) => x.replace(/<MsgId>[^<]*<\/MsgId>/, `<MsgId>${UETR}</MsgId>`)],
  ];

  it.each(tampered)('marca inválido: %s', async (_label, tamper) => {
    const base = good();
    const bad = tamper(base);
    expect(bad).not.toBe(base);
    const result = await validateXML({
      xml: { fileName: 'bad.xml', contents: bad },
      schema: { fileName: 'pain.001.001.09.xsd', contents: readFileSync(`${XSD_DIR}pain.001.001.09.xsd`, 'utf8') },
    });
    expect(result.valid).toBe(false);
  });
});

describe('estado de cuenta con movimientos ajenos a una corrida', () => {
  it('camt.053 con un fondeo sin referencias ISO sigue siendo válido', async () => {
    const funding: Entry = { amount: '500000.00', direction: 'CRDT', bookedAt: NOW, remittance: 'Fondeo de capital de trabajo', settlement: { ...SETTLEMENT, txHash: 'c'.repeat(64) } };
    await expectValid(
      buildCamt053({
        msgId: 'STM-1', statementId: 'S-1', createdAt: NOW, from: NOW, to: NOW, account: COOP.account, accountOwner: COOP.name,
        currency: 'MXN', openingBalance: '0.00', closingBalance: '484600.00', entries: [funding, entry('DBIT', '15400.00')],
      }),
      'camt.053.001.08',
    );
  });
});
