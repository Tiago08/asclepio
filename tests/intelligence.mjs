import assert from 'node:assert/strict';
import {BASICS} from '../js/basics.js';
import {trainMicroModels,predictMicro,estimateMissing,adaptiveEnergy,foodSignature,trainPreferences,recommendFoods,nutrientValue} from '../js/intelligence.js';

const models=trainMicroModels(BASICS);
assert.equal(Object.keys(models).length,7);
for(const model of Object.values(models)){
  assert.ok(model.count>0);
  if(model.active){assert.ok(model.mae<model.baseline*.9);assert.ok(model.count>=30);}
}
assert.equal(nutrientValue({iron_mg:'',micros:{iron_mg:0}},'iron_mg'),0);
assert.equal(nutrientValue({iron_mg:-1},'iron_mg'),null);
assert.equal(predictMicro(models,{source:'custom',category:'Granos',kcal:130,protein_g:3,carbs_g:28,fat_g:0},'zinc_mg'),null);
assert.equal(predictMicro(models,{...BASICS[0],category:'Desconocido'},'zinc_mg'),null);
assert.equal(predictMicro(models,{...BASICS[0],brand:'Fortificado'},'zinc_mg'),null);
const catalog=[{...BASICS[0],id:'rice'}],row={id:'r1',food_id:'rice',quantity:2,kcal:260,protein_g:5.38,carbs_g:56.34,fat_g:.56,micros:{zinc_mg:0}};
const before=JSON.stringify(row),estimates=estimateMissing([row],catalog,models);
assert.equal(estimates[0].zinc_mg,undefined,'Un cero documentado no se imputa');
assert.equal(estimates[0].magnesium_mg.value,24,'El catálogo escala la porción');
assert.equal(estimates[0].magnesium_mg.method,'catalog');
assert.equal(JSON.stringify(row),before,'Sin mutación de registros');
assert.deepEqual(estimateMissing([{...row,quantity:null}],catalog,models),[{}]);
assert.deepEqual(estimateMissing([{...row,food_id:null}],catalog,models),[{}]);

const day=n=>new Date(Date.UTC(2026,0,1+n,12)).toISOString().slice(0,10);
const foods=[],weights=[],completed={};
// Balance sintético: 2200 ingeridas, gasto real 2600. Referencia 2200.
for(let i=0;i<50;i++){
  const food={id:'food-'+i,log_date:day(i),kcal:2200};foods.push(food);
  completed[day(i)]=foodSignature([food]);
  weights.push({log_date:day(i),weight_kg:80-400/7700*i});
}
const input={foods,weights,completed,prior:2200,bmr:1600,today:day(50)};
const active=adaptiveEnergy(input);
assert.equal(active.state,'active');
assert.ok(Math.abs(active.tdee-2600)<80);
assert.ok(active.mae<active.baseline*.9);
assert.equal(adaptiveEnergy({...input,completed:{}}).state,'collecting');
assert.equal(adaptiveEnergy({...input,weights:weights.slice(0,5)}).state,'collecting');
assert.equal(adaptiveEnergy({...input,prior:2600}).state,'baseline','No activar si no mejora la referencia');
assert.equal(adaptiveEnergy({...input,today:day(60)}).state,'stale');
assert.equal(adaptiveEnergy({...input,foods:foods.filter((_,i)=>i!==30)}).state,'collecting','No rellenar huecos con cero');
assert.equal(adaptiveEnergy({...input,foods:foods.map((r,i)=>i===30?{...r,kcal:2100}:r)}).state,'collecting','Una edición invalida la confirmación del día');
assert.deepEqual(adaptiveEnergy({...input,foods:[...foods,{id:'future',log_date:day(51),kcal:9999}],weights:[...weights,{log_date:day(51),weight_kg:150}]}),active,'No usar datos futuros');
// Perturbar la última etiqueta nunca altera las predicciones anteriores.
const noisy=adaptiveEnergy({...input,weights:weights.map((w,i)=>i===49?{...w,weight_kg:w.weight_kg+5}:w)});
assert.ok(noisy.mae>active.mae);

const choices=[{...BASICS[0],id:'a'},{...BASICS.find(f=>f.category==='Lácteos'),id:'b'}];
const logs=Array.from({length:80},(_,i)=>({id:String(i),food_id:i%2?'b':'a',log_date:day(Math.floor(i/2)),log_time:i%2?'19:00':'07:00',momento:i%2?'Cena':'Desayuno'}));
const preferences=trainPreferences(logs,choices);
assert.equal(preferences.active,true);
assert.ok(preferences.error<preferences.baseline*.95);
assert.equal(trainPreferences(logs.slice(0,5),choices).active,false);
const args={catalog:BASICS,targets:[],totals:{},coverage:{},goals:{goal_kcal:2000,goal_protein_g:150},kcal:800,protein:20,logs:[],meal:'Almuerzo'};
const recommendations=recommendFoods(args);
assert.ok(recommendations.items.length>0 && recommendations.items.length<=3);
assert.equal(new Set(recommendations.items.map(i=>i.food.category)).size,recommendations.items.length);
for(const item of recommendations.items){assert.ok(item.kcal<=1200);assert.ok(!/crud[oa]|harina|cerveza|vino|licor/i.test(item.food.name));}
const hidden=recommendations.items.map(i=>i.key);
assert.ok(recommendFoods({...args,hidden}).items.every(i=>!hidden.includes(i.key)));
assert.equal(recommendFoods({...args,kcal:1990}).items.length,0);
assert.equal(recommendFoods({...args,completeMacros:false}).items.length,0);
assert.deepEqual(recommendFoods({...args,catalog:[{...BASICS[0],protein_g:null}]}).items,[]);
const partial=recommendFoods({...args,protein:150,targets:[{key:'iron_mg',goal:18}],coverage:{iron_mg:{known:1,total:2}}});
assert.equal(partial.items.length,0,'No recomendar por una carencia inferida de datos parciales');
console.log('OK: modelos de micros, abstención, porciones, no mutación, balance energético temporal, datos incompletos y preferencias.');
console.log(JSON.stringify(Object.values(models).map(({key,active,count,mae,baseline})=>({key,active,count,mae,baseline})),null,2));
