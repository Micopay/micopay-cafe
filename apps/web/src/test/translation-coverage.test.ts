import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EN } from '../i18n';

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!./**'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

describe('Translation coverage', () => {
  it('every literal t() key has an entry in the EN dictionary', () => {
    const missing: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const broken = (source as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
      expect(broken, `${file} does not parse`).toHaveLength(0);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
          const arg = node.arguments[0];
          if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) && !(arg.text in EN)) {
            const line = source.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
            missing.push(`${file}:${line} "${arg.text}"`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    expect(missing, `t() keys without EN translation:\n${missing.join('\n')}`).toEqual([]);
  });
});
