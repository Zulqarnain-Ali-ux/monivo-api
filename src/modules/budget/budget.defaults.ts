import { BudgetGroup } from './budget-category.entity';

interface DefaultCategory {
  catId: string;
  name: string;
  groupType: BudgetGroup;
  catKey: string;
  amount: number;
  icon: string;
  isDefault: boolean;
}

export function defaultBudgetCategories(income: number): DefaultCategory[] {
  const i = income || 4000;
  return [
    // Fixed
    { catId:'rent',    name:'Rent / Mortgage',    groupType:'fixed',    catKey:'rent',          amount:Math.round(i*.30), icon:'🏠', isDefault:true },
    { catId:'util',    name:'Utilities',           groupType:'fixed',    catKey:'utilities',     amount:Math.round(i*.05), icon:'💡', isDefault:true },
    { catId:'insure',  name:'Insurance',           groupType:'fixed',    catKey:'insurance',     amount:Math.round(i*.04), icon:'🛡️', isDefault:true },
    { catId:'car',     name:'Car payment',         groupType:'fixed',    catKey:'car',           amount:0,                 icon:'🚗', isDefault:true },
    { catId:'phone',   name:'Phone bill',          groupType:'fixed',    catKey:'other',         amount:80,                icon:'📱', isDefault:true },
    { catId:'subs',    name:'Subscriptions',       groupType:'fixed',    catKey:'subscriptions', amount:60,                icon:'🔁', isDefault:true },
    { catId:'bank',    name:'Bank fees / loans',   groupType:'fixed',    catKey:'bank',          amount:0,                 icon:'🏦', isDefault:true },
    // Variable
    { catId:'groc',    name:'Groceries',           groupType:'variable', catKey:'groceries',     amount:Math.round(i*.12), icon:'🛒', isDefault:true },
    { catId:'dining',  name:'Dining & coffee',     groupType:'variable', catKey:'dining',        amount:Math.round(i*.07), icon:'☕', isDefault:true },
    { catId:'gas',     name:'Gas / fuel',          groupType:'variable', catKey:'gas',           amount:Math.round(i*.04), icon:'⛽', isDefault:true },
    { catId:'trans',   name:'Transport',           groupType:'variable', catKey:'transport',     amount:Math.round(i*.03), icon:'🚌', isDefault:true },
    { catId:'health',  name:'Health & medical',    groupType:'variable', catKey:'health',        amount:Math.round(i*.03), icon:'💊', isDefault:true },
    { catId:'shop',    name:'Shopping',            groupType:'variable', catKey:'shopping',      amount:Math.round(i*.05), icon:'🛍',  isDefault:true },
    { catId:'fun',     name:'Entertainment',       groupType:'variable', catKey:'fun',           amount:Math.round(i*.04), icon:'🎉', isDefault:true },
    { catId:'personal',name:'Personal care',       groupType:'variable', catKey:'other',         amount:Math.round(i*.02), icon:'✂️', isDefault:true },
    // Financial
    { catId:'savings', name:'Savings',             groupType:'financial',catKey:'savings',       amount:Math.round(i*.10), icon:'💰', isDefault:true },
    { catId:'invest',  name:'Investments',         groupType:'financial',catKey:'investments',   amount:Math.round(i*.05), icon:'📈', isDefault:true },
    { catId:'debt',    name:'Debt paydown',        groupType:'financial',catKey:'debt',          amount:0,                 icon:'📉', isDefault:true },
  ];
}
