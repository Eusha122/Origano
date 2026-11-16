import { describe, expect, it } from 'vitest';
import { addMoney, maxMoney, multiplyMoney, percentOf, poisha, subtractMoney, taka, toTaka } from './money';

describe('money', () => {
  it('stores taka as whole poisha', () => {
    expect(taka(280)).toBe(28000);
    expect(taka(15.5)).toBe(1550);
    expect(toTaka(taka(280))).toBe(280);
  });

  it('rejects amounts that are not valid money', () => {
    expect(() => taka(-1)).toThrow(RangeError);
    expect(() => taka(Number.NaN)).toThrow(RangeError);
    expect(() => taka(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => taka(10.005)).toThrow(RangeError); // finer than one poisha
  });

  it('accepts large two-decimal amounts exactly', () => {
    expect(taka(131072.02)).toBe(13107202);
    expect(taka(1234567.89)).toBe(123456789);
    expect(taka(525965.55)).toBe(52596555);
    expect(() => taka(2.675)).toThrow(RangeError); // still finer than one poisha
  });

  it('builds money from a stored poisha count', () => {
    expect(poisha(13107202)).toBe(taka(131072.02));
    expect(() => poisha(1.5)).toThrow(RangeError);
    expect(() => poisha(-1)).toThrow(RangeError);
  });

  it('adds, subtracts and multiplies', () => {
    expect(addMoney()).toBe(0);
    expect(addMoney(taka(380), taka(180))).toBe(taka(560));
    expect(subtractMoney(taka(560), taka(20))).toBe(taka(540));
    expect(multiplyMoney(taka(140), 3)).toBe(taka(420));
    expect(maxMoney(taka(20), taka(35))).toBe(taka(35));
  });

  it('never goes below zero or accepts a broken quantity', () => {
    expect(() => subtractMoney(taka(20), taka(21))).toThrow(RangeError);
    expect(() => multiplyMoney(taka(140), -1)).toThrow(RangeError);
    expect(() => multiplyMoney(taka(140), 1.5)).toThrow(RangeError);
  });

  it('takes the commission in the book example exactly', () => {
    expect(percentOf(taka(20000), 5)).toBe(taka(1000));
  });

  it('rounds a percentage half up to the nearest whole taka', () => {
    expect(percentOf(taka(310), 5)).toBe(taka(16)); // 15.50 -> 16
    expect(percentOf(taka(309), 5)).toBe(taka(15)); // 15.45 -> 15
    expect(percentOf(taka(0), 5)).toBe(taka(0));
  });

  it('rejects a percentage outside 0 to 100', () => {
    expect(() => percentOf(taka(100), -5)).toThrow(RangeError);
    expect(() => percentOf(taka(100), 101)).toThrow(RangeError);
  });
});
