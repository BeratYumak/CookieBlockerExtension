/**
 * "Bu sitede izin ver" eyleminin kapsamı: adres yolu (path) hiç rol oynamamalı,
 * eylem sitenin tamamına (eTLD+1 + alt alan adları) uygulanmalı.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helper.mjs';

const { CS } = setup(null, { url: 'https://ornek.com/' });

test('registrableDomain: alt alan adları siteye indirgenir', () => {
  assert.equal(CS.registrableDomain('github.com'), 'github.com');
  assert.equal(CS.registrableDomain('www.github.com'), 'github.com');
  assert.equal(CS.registrableDomain('gist.github.com'), 'github.com');
  assert.equal(CS.registrableDomain('raw.githubusercontent.com'), 'githubusercontent.com');
  assert.equal(CS.registrableDomain('accounts.google.com'), 'google.com');
  assert.equal(CS.registrableDomain('a.b.c.example.org'), 'example.org');
  assert.equal(CS.registrableDomain('EXAMPLE.COM.'), 'example.com');
});

test('registrableDomain: çok parçalı ülke sonekleri', () => {
  assert.equal(CS.registrableDomain('www.hepsiburada.com.tr'), 'hepsiburada.com.tr');
  assert.equal(CS.registrableDomain('internet.isbank.com.tr'), 'isbank.com.tr');
  assert.equal(CS.registrableDomain('mail.metu.edu.tr'), 'metu.edu.tr');
  assert.equal(CS.registrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(CS.registrableDomain('shop.example.com.au'), 'example.com.au');
  assert.equal(CS.registrableDomain('www.nhk.or.jp'), 'nhk.or.jp');
});

test('registrableDomain: paylaşımlı barındırma sonekleri site sınırıdır', () => {
  assert.equal(CS.registrableDomain('berat.github.io'), 'berat.github.io');
  assert.equal(CS.registrableDomain('proje.pages.dev'), 'proje.pages.dev');
  assert.equal(CS.registrableDomain('app.vercel.app'), 'app.vercel.app');
  assert.equal(CS.registrableDomain('kova.s3.amazonaws.com'), 'kova.s3.amazonaws.com');
});

test('registrableDomain: IP, localhost ve tek etiket olduğu gibi kalır', () => {
  assert.equal(CS.registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(CS.registrableDomain('192.168.1.50'), '192.168.1.50');
  assert.equal(CS.registrableDomain('localhost'), 'localhost');
  assert.equal(CS.registrableDomain(''), '');
  assert.equal(CS.registrableDomain(null), '');
});

test('site kapsamı adres yolundan bağımsızdır', () => {
  const urls = [
    'https://github.com/',
    'https://github.com/berat/cookie-shield',
    'https://github.com/berat/cookie-shield/blob/main/README.md?x=1#L2',
    'https://gist.github.com/berat/abc123'
  ];
  const kapsamlar = urls.map((u) => CS.registrableDomain(new URL(u).hostname));
  assert.deepEqual([...kapsamlar], ['github.com', 'github.com', 'github.com', 'github.com']);
});

test('bir repo sayfasında verilen izin github.com genelini kapsar', () => {
  const site = CS.registrableDomain(new URL('https://github.com/berat/cookie-shield').hostname);
  const allowlist = CS.toggleHostList([], site, true);
  assert.deepEqual([...allowlist], ['github.com']);
  for (const h of ['github.com', 'www.github.com', 'gist.github.com', 'api.github.com', '.github.com']) {
    assert.equal(CS.hostMatches(allowlist, h), true, h + ' kapsanmalı');
  }
  // Başka siteye sızmamalı
  assert.equal(CS.hostMatches(allowlist, 'github.io'), false);
  assert.equal(CS.hostMatches(allowlist, 'notgithub.com'), false);
  assert.equal(CS.hostMatches(allowlist, 'evil-github.com.tr'), false);
});

test('alt alan adında verilen izin ana alan adını da korur', () => {
  const site = CS.registrableDomain('gist.github.com');
  const allowlist = CS.toggleHostList([], site, true);
  // Oturum çerezi .github.com üzerinde durur: kapsanmalı
  assert.equal(CS.hostMatches(allowlist, 'github.com'), true);
});

test('toggleHostList: kaldırma eski dar kayıtları da temizler', () => {
  const list = CS.toggleHostList(['gist.github.com', 'www.github.com', 'baska.com'], 'github.com', false);
  assert.deepEqual([...list], ['baska.com']);
  assert.equal(CS.hostMatches(list, 'gist.github.com'), false);
});

test('toggleHostList: tekrarlı ekleme kopya üretmez, www normalize edilir', () => {
  let list = CS.toggleHostList([], 'www.github.com', true);
  list = CS.toggleHostList(list, 'github.com', true);
  assert.deepEqual([...list], ['github.com']);
});

test('toggleHostList: geçersiz host listeyi bozmaz', () => {
  assert.deepEqual([...CS.toggleHostList(['a.com'], '', true)], ['a.com']);
  assert.deepEqual([...CS.toggleHostList(null, '', false)], []);
});
