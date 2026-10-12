import sys, uuid
from datetime import datetime, timezone, timedelta
from lxml import etree
sys.path.insert(0, sys.argv[1])
from core.iso_generator import ISO20022Generator as G
xsd = sys.argv[2]
g = G()
def check(name, xml, schema):
    s = etree.XMLSchema(etree.parse(f"{xsd}/{schema}.xsd"))
    doc = etree.fromstring(xml.encode())
    ok = s.validate(doc)
    print(f"\n== {name} ({schema}): {'VALIDO' if ok else 'INVALIDO'}")
    seen=set()
    for e in s.error_log:
        import re; m = re.sub(r"{urn:[^}]*}", "", e.message)
        if m in seen: continue
        seen.add(m); print("  -", f"L{e.line}: "+m[:400])
for ccy in ["XRP","USDC"]:
    u = str(uuid.uuid4())
    p = dict(uetr=u, amount=1234.5, currency=ccy, debtor_name="Cooperativa X", debtor_account="rDebtor", creditor_name="Productor Y", creditor_account="rCreditor", xrpl_tx_hash="AB"*32, end_to_end_id="E2E-123")
    check(f"pacs.008 {ccy}", g.generate_pacs008(p), "pacs.008.001.08")
    check(f"camt.054 {ccy}", g.generate_camt054(p), "camt.054.001.08")
    check(f"pacs.002 ACSC {ccy}", g.generate_pacs002(p, "tesSUCCESS", escrow_fulfillment="A0228020"+"00"*32), "pacs.002.001.10")
    check(f"pacs.002 RJCT {ccy}", g.generate_pacs002({**p,'rejection_reason':'calidad'}, "tecNO_DST"), "pacs.002.001.10")
    now=datetime.now(timezone.utc)
    check(f"camt.053 {ccy}", g.generate_camt053([{**p,'amount':100},{**p,'amount':50}], dict(account_id="rOperator", account_name="Op", statement_id=str(uuid.uuid4()), from_date=now-timedelta(days=1), to_date=now)), "camt.053.001.08")
