import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/legacy.js', import.meta.url), 'utf8');

function statementContext() {
  const fields = {
    'st-search': { value: 'زبون' },
    'st-from': { value: '' },
    'st-to': { value: '' },
    'st-res': { innerHTML: '' },
    'st-view-detailed': { className: '' },
    'st-view-summary': { className: '' },
  };
  const context = vm.createContext({
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null },
    document: { getElementById: id => fields[id] },
    console,
  });
  vm.runInContext(source, context);
  return { context, fields };
}

function statementRows(html) {
  const body = html.match(/<tbody>(.*?)<\/tbody>/s)?.[1] || '';
  return [...body.matchAll(/<tr>(.*?)<\/tr>/gs)].map(([, row]) =>
    [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(([, cell]) => cell.replace(/<[^>]*>/g, '').trim()),
  );
}

function seedStatement(context) {
  vm.runInContext(`state.contacts = [
    {id:1, name:'زبون', openingBal:0},
    {id:2, name:'بائع', openingBal:0}
  ];
  state.transactions = [
    {id:1, type:'فاتورة', date:'2026-10-01T09:00:00', contactId:1, secondaryId:2, amount:905, details:{tQty:2, raw:900, sellerCredit:870}},
    {id:2, type:'فاتورة', date:'2026-10-01T09:00:00', contactId:1, secondaryId:2, amount:1377.5, details:{tQty:3, raw:1370, sellerCredit:1330}},
    {id:3, type:'قبض', date:'2026-10-01T09:30:00', contactId:1, amount:50},
    {id:4, type:'فاتورة', date:'2026-10-01T10:00:00', contactId:1, secondaryId:2, amount:102.5, details:{tQty:1, raw:100, sellerCredit:97, invoiceGroupId:'new-invoice'}}
  ];`, context);
}

test('summary groups one invoice, keeps later invoices and vouchers separate, and preserves balance order', () => {
  const { context, fields } = statementContext();
  seedStatement(context);
  vm.runInContext("setStatementView('summary')", context);
  const rows = statementRows(fields['st-res'].innerHTML);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => [row[3], row[4], row[5], row[8]]), [
    ['مشتريات', '5', '2270.00', '2282.50'],
    ['وصل قبض', '-', '-', '2232.50'],
    ['مشتريات', '1', '100.00', '2335.00'],
  ]);
  assert.match(fields['st-res'].innerHTML, /السعر الإجمالي/);
  assert.doesNotMatch(fields['st-res'].innerHTML, /onclick="openStatementGroupDetails/);
});

test('detail lists every invoice item with its unit price in the page', () => {
  const { context, fields } = statementContext();
  seedStatement(context);
  vm.runInContext("setStatementView('detailed')", context);
  const rows = statementRows(fields['st-res'].innerHTML);

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => [row[4], row[5]]), [
    ['2', '450.00'],
    ['3', '456.67'],
    ['-', '-'],
    ['1', '100.00'],
  ]);
  assert.match(fields['st-res'].innerHTML, /سعر المفردة/);
  assert.doesNotMatch(fields['st-res'].innerHTML, /onclick="openStatementGroupDetails/);
});

test('saving one invoice assigns the same group ID to all of its items', async () => {
  const { context, fields } = statementContext();
  fields['i-date'] = { value: '2026-10-01' };
  vm.runInContext(`state.contacts = [
    {id:1, name:'زبون', balance:0},
    {id:2, name:'بائع', balance:0}
  ];
  state.invoiceItems = [
    {qty:2, price:450, total:900, buyer:'زبون', seller:'بائع'},
    {qty:3, price:456.6666666667, total:1370, buyer:'زبون', seller:'بائع'}
  ];
  dbSave = async () => {};
  navigate = () => {};`, context);
  await vm.runInContext('saveInv()', context);
  const groups = vm.runInContext('state.transactions.map(t => t.details.invoiceGroupId)', context);

  assert.equal(groups.length, 2);
  assert.ok(groups[0]);
  assert.equal(groups[0], groups[1]);
});

test('date fields open the native calendar and keep a focus fallback', () => {
  const { context, fields } = statementContext();
  let opened = 0;
  let focused = 0;
  fields['st-from'] = { showPicker: () => { opened++; } };
  fields['rep-to'] = { focus: () => { focused++; } };

  vm.runInContext("openDatePicker('st-from'); openDatePicker('rep-to')", context);
  assert.equal(opened, 1);
  assert.equal(focused, 1);
});
