import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_MS, cleanWord, validWord, remainingMs, roundKey, everyoneSubmitted, evaluateRound } from '../logic.mjs';

const two = {a:{name:'小天'}, b:{name:'阿月'}};
const three = {...two, c:{name:'小夏'}};

test('双人：词完全一致才成功', () => {
  const r = evaluateRound(two, {a:'星星',b:'星星'}, 2);
  assert.equal(r.matched, true); assert.equal(r.word, '星星');
  assert.equal(evaluateRound(two, {a:'星星',b:'星河'}, 2).matched, false);
});
test('三人：必须三个人全部一致', () => {
  assert.equal(evaluateRound(three, {a:'月亮',b:'月亮',c:'月亮'}, 3).matched, true);
  assert.equal(evaluateRound(three, {a:'月亮',b:'月亮',c:'星星'}, 3).matched, false);
});
test('超时未提交：不能获得胜利', () => {
  const r = evaluateRound(three, {a:'雨',b:'雨'}, 3);
  assert.equal(r.matched,false); assert.equal(r.timedOut,true);
  assert.equal(r.rows[2].timedOut,true);
});
test('双人/三人提交数量必须达到容量', () => {
  assert.equal(everyoneSubmitted(two, {a:true,b:true},2),true);
  assert.equal(everyoneSubmitted(three, {a:true,b:true},3),false);
  assert.equal(everyoneSubmitted(three, {a:true,b:true,c:true},3),true);
});
test('统一20秒倒计时', () => {
  const start = 1700000000000;
  assert.equal(ROUND_MS,20000);
  assert.equal(remainingMs(start,start),20000);
  assert.equal(remainingMs(start,start+5000),15000);
  assert.equal(remainingMs(start,start+20000),0);
  assert.equal(remainingMs(start,start+30000),0);
});
test('仅忽略两侧空格（大小写与繁体不视为相同）', () => {
  assert.equal(cleanWord(' 太阳  '),'太阳');
  assert.equal(validWord(' '),false);
  assert.equal(validWord('日'.repeat(25)),false);
  assert.equal(evaluateRound(two,{a:'Sun',b:'sun'},2).matched,false);
  assert.equal(evaluateRound(two,{a:'云',b:'雲'},2).matched,false);
});
test('房间重开生成各自独立的轮次键', () => {
  assert.equal(roundKey(1,1),'g1r1');
  assert.equal(roundKey(1,2),'g1r2');
  assert.equal(roundKey(2,1),'g2r1');
});
