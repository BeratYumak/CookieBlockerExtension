# 🛡️ Cookie Shield

Brave (ve Chromium tabanlı diğer tarayıcılar) için Manifest V3 eklentisi.

**Varsayılan olarak hiçbir şey yapmaz.** Bir sitede çerez uyarısı seni zorladığında
🛡️ simgesine tıklayıp *"&lt;site&gt; için korumayı aç"* dersin; eklenti yalnızca o
sitede (ve alt alan adlarında) devreye girer. Geri kalan her yerde tarayıcın
tamamen dokunulmamış kalır — ne çerez engellenir, ne banner'a müdahale edilir,
ne ek istek başlığı gönderilir.

Açtığın sitede üç işi birlikte yapar:

1. **Çerez onay pop-up'ını kapatır** — banner'ı sadece gizlemek yerine sitenin
   kendi *"Tümünü Reddet"* akışını tetikler. Site rızayı **red** olarak kaydeder,
   bu yüzden özellikler kapanmaz ve banner her ziyarette geri gelmez.
2. **Çerezleri engeller** — `Cookie` / `Set-Cookie` başlıkları ağ katmanında
   (declarativeNetRequest) kaldırılır, JS ile yazılan çerezler silinir veya
   hafızadaki *sanal kavanoza* yönlendirilir.
3. **Reddetmeye izin vermeyen siteleri aşar** — çerez duvarı, kaydırma kilidi,
   bulanıklık ve örtü katmanı temizlenir; isteklerde `Sec-GPC: 1` + `DNT: 1`
   gönderilir ve Google Consent Mode'a `denied` bildirilir.

## Kullanım akışı

1. Siteye girdin, çerez uyarısı çıktı ve kabul etmek istemiyorsun.
2. 🛡️ simgesine tıkla → **"&lt;site&gt; için korumayı aç"**.
3. Eklenti o site için kuralları yazar, sitenin mevcut çerezlerini siler ve
   sekmeyi yeniler (ayarlardan kapatılabilir). Sayfa açık kalsa bile reddetme
   turu anında başlar.
4. Sitede işin bittiğinde aynı düğmeyle korumayı kapatabilirsin; kurallar ve
   liste kaydı temizlenir, site tamamen normale döner.

Eski (agresif) davranışı isteyenler için **Kapsam → Tüm siteler** seçeneği durur:
o modda eklenti her sitede çalışır ve istisnalar izin listesinden yönetilir.

## Kurulum (Brave / Chrome / Edge)

```bash
git clone https://github.com/BeratYumak/cookie-shield.git
```

veya GitHub'daki **Code → Download ZIP** ile indirip bir yere çıkart.

1. `brave://extensions` adresini aç (Chrome'da `chrome://extensions`,
   Edge'de `edge://extensions`).
2. Sağ üstten **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle** → indirdiğin `cookie-shield` klasörünü seç
   (`manifest.json` dosyasının bulunduğu klasör).
4. Adres çubuğunun yanındaki 🛡️ simgesinden modu seç. Simge görünmüyorsa
   yapboz parçası menüsünden sabitle.

İlk kurulumda ayarlar sayfası otomatik açılır. Eklenti güncellendiğinde
`brave://extensions` üzerindeki **yeniden yükle** (🔄) düğmesine bas.

> `npm install` kurulum için gerekli değildir; bağımlılıklar yalnızca testlerde
> kullanılır. Dağıtılabilir bir arşiv istersen `npm run package` →
> `dist/cookie-shield.zip`.

## Ekran görüntüleri

| Popup | Ayarlar |
| --- | --- |
| ![Popup](docs/popup.png) | ![Ayarlar](docs/options.png) |

Saha kanıtı (milliyet.com.tr, eklenti kapalı → açık):

| Kapalı: banner + 25 çerez | Açık: banner yok, 0 çerez |
| --- | --- |
| ![Kapalı](docs/ab-milliyet.com.tr-kapali.png) | ![Açık](docs/ab-milliyet.com.tr-acik.png) |


## Kapsam ve çerez modları

**Kapsam** eklentinin nerede çalıştığını, **çerez modu** çalıştığı yerde ne kadar
katı olduğunu belirler.

| Kapsam | Ne yapar |
| --- | --- |
| **Sadece açtığım siteler** (varsayılan) | Eklenti yalnızca `enabledSites` listesindeki sitelerde çalışır. Liste boşken tarayıcıya hiç dokunulmaz: statik kural seti açılmaz, dinamik kural yazılmaz, tarayıcı geneli çerez ayarı değiştirilmez. |
| **Tüm siteler** | Her sitede çalışır; istisnalar izin listesi ve "eklentinin kapalı olduğu siteler" listesinden yönetilir (1.0 davranışı). |

| Çerez modu | Ne yapar | Kime uygun |
| --- | --- | --- |
| **Tümünü engelle** (varsayılan) | Açık sitede çerez yazımı ve gönderimi engellenir. `document.cookie` sanal kavanoza yazılır: sayfa çalışır, çerez diske yazılmaz, sunucuya gitmez. | En katı gizlilik. Giriş yaptığın sitede korumayı kapat. |
| **Oturum boyu** | Çerezler normal çalışır, sitenin son sekmesi kapanınca silinir. Üçüncü taraf çerezler yine engellenir. | "Girişler bozulmasın ama iz kalmasın" isteyenler. |
| **Sadece 3. taraf** | Takipçi çerezleri engellenir, sitenin kendi çerezleri kalır. | Günlük kullanım, en az sürtünme. |
| **Kapalı** | Çerezlere dokunulmaz, sadece pop-up reddi çalışır. | Yalnızca banner'lardan kurtulmak isteyenler. |

Eylemler **site bazlıdır, adres yolu (path) hiç dikkate alınmaz.** Popup'taki
eylemler (korumayı aç/kapat / çerezleri sil) aktif sekmenin kayıtlanabilir alan
adına (eTLD+1) uygulanır ve tüm alt alan adlarını kapsar:

- `github.com/berat/proje` sayfasında aç → kayıt `github.com`,
  `gist.github.com` ve `api.github.com` dahil site geneli kapsanır.
- `gist.github.com` üzerinde aç → yine `github.com` yazılır; oturum çerezi
  `.github.com` üzerinde durduğu için kapsam tutarlı olur.
- `hepsiburada.com.tr`, `bbc.co.uk` gibi çok parçalı sonekler doğru ayrıştırılır;
  `berat.github.io` / `proje.pages.dev` gibi paylaşımlı barındırma soneklerinde
  kapsam yalnızca kendi alt alan adıdır (komşu sitelere sızmaz).
- Korumayı kapattığında o sitenin altındaki daha dar kayıtlar da temizlenir.

Daha dar bir kapsam istersen ayarlar sayfasındaki listeye tek bir alt alan adı
(`gist.github.com`) elle yazabilirsin.

## Nasıl çalışıyor?

```
manifest.json
├── src/page/page-agent.js      MAIN dünya: CMP JS API'leri, sanal çerez kavanozu, GPC
├── src/content/core.js         Banner puanlama + çok dilli buton sınıflandırma
├── src/content/adapters.js     25+ CMP için özel seçiciler (shadow DOM dahil)
├── src/content/engine.js       Akış: adaptör → sezgisel → son çare + zamanlama
├── src/background/service-worker.js  Mod uygulama, DNR kuralları, çerez silme, istatistik
├── rules/*.json                Çerez başlığı sıyırma + GPC/DNT sinyali kuralları
└── src/popup, src/options      Arayüz
```

Reddetme sırası (ilki tutunca durur):

1. **CMP'nin kendi API'si** — `OneTrust.RejectAll()`, `Cookiebot.decline()`,
   `Didomi.setUserDisagreeToAll()`, `UC_UI.denyAllConsents()`, `Osano.cm.denyAll()`,
   `klaro`, `_iub.cs.api.reject()`, `cmplz_deny_all()`, `tarteaucitron`,
   `ppms.cm.api('rejectAllConsents')`, `__cmp('rejectAll')` …
2. **CMP adaptörü** — OneTrust, Cookiebot, Quantcast, Didomi, Usercentrics, Osano,
   Iubenda, Klaro, Termly, CookieYes, Complianz, Borlabs, Sourcepoint, TrustArc,
   Axeptio, tarteaucitron, FundingChoices, HubSpot, Cookie Script, WP eklentileri,
   Moove, Piwik PRO, Sirdata, Ketch (Shadow DOM'a da bakar).
3. **Sezgisel tarama** — banner adayları konum/z-index/sınıf adı/metin/buton
   türlerine göre puanlanır; "Reddet" butonu yoksa tercih paneli açılır, isteğe
   bağlı kutular kapatılır ve kaydedilir. **Zorunlu/gerekli kutulara dokunulmaz.**
4. **Son çare** — rıza hiç kaydedilemiyorsa banner + perde gizlenir ve sayfa kilidi
   açılır. Yalnızca çerez bağlamı doğrulanan öğelere uygulanır; `main`/`article`
   içeren veya 40'tan fazla bağlantı barındıran öğeler banner sayılmaz.

Türkçe dahil 10+ dil desteklenir (`Tümünü Reddet`, `Sadece Zorunlu Çerezler`,
`Kabul Etmiyorum`, `Alle ablehnen`, `Continuer sans accepter`, `Solo las necesarias`…).
`İ`/`ı` gibi Türkçe karakterler Unicode NFD ile normalize edilir.

## Bilinen sınırlar

- **Sunucu tarafı çerez duvarı** (içerik hiç gönderilmiyorsa) tarayıcı eklentisiyle
  aşılamaz — orada abonelik/ödeme duvarı vardır.
- **Tümünü engelle** modunda korumayı açtığın sitede oturum açıksan "çıkış yapıldı"
  davranışı normaldir: etkinleştirme o sitenin çerezlerini siler. Giriş gerekiyorsa
  korumayı kapat ya da "oturum boyu" moduna geç.
- Site kapsamında korumayı açtığın sayfaya gömülü üçüncü taraf iframe'lerin *kendi
  içindeki* `document.cookie` yazımları engellenmez; o çerezler ağ katmanında
  (`Set-Cookie` / `Cookie` sıyırma) durdurulur.
- Geçerli TCF onay dizesi (TCString) üretilmez; standart dışı `rejectAll` komutunu
  desteklemeyen TCF CMP'lerinde DOM tıklaması veya son çare devreye girer.
- `document.cookie` koruması `document_start`'ta kurulur; ayarlar okunana kadarki
  yazımlar tamponlanır (site kapsam dışıysa gerçek çerezlere aktarılır, içindeyse
  kavanozda kalır). Hiçbir yazım kaybolmaz.

## Test

```bash
npm install            # jsdom + puppeteer-core (yalnızca test için)
npm run lint           # tüm kaynaklarda söz dizimi kontrolü
npm test               # 48 birim/DOM testi (jsdom)
npm run e2e            # gerçek Brave'de 38 uçtan uca kontrol
node test/real-sites.mjs   # canlı sitelerde saha kontrolü (ağ gerekir)
```

Son doğrulama durumu:

- `npm test` → 48/48 geçti
- `npm run e2e` → 38/38 geçti: varsayılanda **sıfır müdahale** (banner'a
  dokunulmaz, çerez çalışır, kural yazılmaz), sayfa açıkken etkinleştirmenin
  reddetmeyi anında tetiklemesi, gerçek reddet tıklaması, API çağrısı,
  `Set-Cookie` engelleme, sanal kavanoz, çerez duvarı, kapsamın alt alan
  adlarını kapsayıp komşu siteye sızmaması, korumayı kapatınca her şeyin
  normale dönmesi, "tüm siteler" kapsamı + izin listesi, arayüzler
- `test/real-sites.mjs` → BBC, Hepsiburada, Milliyet, Zeit, Guardian: banner temiz,
  0 çerez, 13 gerçek reddetme; içerik karşılaştırmasında metin/bağlantı/görsel
  sayıları eklentisiz duruma **eşit** (site bozulmuyor). Bu betik siteleri
  kendisi etkinleştirerek ölçer.

## Gizlilik

Hiçbir veri dışarı gönderilmez. Tüm ayarlar ve sayaçlar `chrome.storage.local`
içinde kalır; uzak sunucu, analitik veya güncelleme çağrısı yoktur.

## Lisans

[MIT](LICENSE) © Berat Yumak
