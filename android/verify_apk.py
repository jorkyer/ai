#!/usr/bin/env python3
"""
Проверка готового APK без Android SDK.

Песочница/CI-окружение не всегда содержит aapt2, apkanalyzer или apksigner,
поэтому валидность сборки проверяется здесь средствами Python:

  1. APK — корректный ZIP с обязательными частями (манифест, dex, resources.arsc);
  2. подпись: APK Signing Block и схема v2/v3 (+ сертификат подписанта);
  3. двоичный AndroidManifest.xml разбирается собственным парсером AXML —
     видны package, versionCode, min/targetSdk, activity, intent-filter;
  4. в dex есть классы и методы WebView-обёртки (диалоги, мост, выбор файла);
  5. ассеты байт-в-байт совпадают с исходниками в calculator/.

Запуск:
    python3 android/verify_apk.py [путь_к.apk]
По умолчанию проверяется apk/progcalc-debug.apk.
Код возврата 0 — проверка пройдена, 1 — есть замечания.
"""

import hashlib
import os
import re
import struct
import sys
import zipfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_APK = os.path.join(REPO_ROOT, 'apk', 'progcalc-debug.apk')

# ассет в APK -> исходник в репозитории
ASSETS = [
    ('assets/index.html', 'calculator/index.html'),
    ('assets/css/style.css', 'calculator/css/style.css'),
    ('assets/js/engine.js', 'calculator/js/engine.js'),
    ('assets/js/app.js', 'calculator/js/app.js'),
    ('assets/js/examples.js', 'calculator/js/examples.js'),
]

# что должно быть в dex-коде обёртки
DEX_MARKERS = [
    b'Lcom/jorkyer/progcalc/MainActivity;',
    b'AndroidBridge', b'UiChromeClient',
    b'onJsPrompt', b'onJsConfirm', b'onJsAlert', b'onShowFileChooser',
    b'saveText', b'addJavascriptInterface', b'setDomStorageEnabled',
    b'file:///android_asset/index.html',
]

ok_count = 0
fail_count = 0


def check(label, ok, detail=''):
    global ok_count, fail_count
    if ok:
        ok_count += 1
    else:
        fail_count += 1
    print('  [%s] %-46s %s' % ('OK ' if ok else 'ОШИБКА', label, detail))


# ---------------------------------------------------------------------------
# Парсер binary AXML (AndroidManifest.xml внутри APK)
# ---------------------------------------------------------------------------

def parse_axml(buf):
    """Возвращает (строки, карта ресурсов, атрибуты, элементы).

    Формат: RES_XML_TYPE -> STRING_POOL -> RESOURCE_MAP -> узлы.
    Узел: type(2) headerSize(2) size(4) lineNumber(4) comment(4).
    START_ELEMENT дополняется attrExt: ns(4) name(4) attributeStart(2)
    attributeSize(2) attributeCount(2) id/class/style(6), затем атрибуты по 20 байт:
    ns(4) name(4) rawValue(4) size(2) res0(1) dataType(1) data(4).
    """
    pos = 8
    strings, resmap, attrs, elements = [], {}, [], []

    while pos + 8 <= len(buf):
        ctyp, chsz, csize = struct.unpack_from('<HHI', buf, pos)
        if csize == 0:
            break

        if ctyp == 0x0001:                                   # пул строк
            cnt, _styles, flags, sstart, _ = struct.unpack_from('<IIIII', buf, pos + 8)
            utf8 = bool(flags & 0x100)
            base = pos + sstart
            for i in range(cnt):
                p = base + struct.unpack_from('<I', buf, pos + chsz + i * 4)[0]
                if utf8:
                    n = buf[p]; p += 2 if n & 0x80 else 1     # длина в символах
                    m = buf[p]; p += 2 if m & 0x80 else 1     # длина в байтах
                    strings.append(buf[p:p + m].decode('utf-8', 'replace'))
                else:
                    n = struct.unpack_from('<H', buf, p)[0]
                    if n & 0x8000:                            # длина > 32767
                        n = ((n & 0x7fff) << 16) | struct.unpack_from('<H', buf, p + 2)[0]
                        p += 4
                    else:
                        p += 2
                    strings.append(buf[p:p + n * 2].decode('utf-16-le', 'replace'))

        elif ctyp == 0x0180:                                 # карта ID ресурсов
            n = (csize - chsz) // 4
            resmap = dict(enumerate(struct.unpack_from('<%dI' % n, buf, pos + chsz)))

        elif ctyp == 0x0102:                                 # начало элемента
            b = pos + chsz
            el = struct.unpack_from('<I', buf, b + 4)[0]
            astart, asize, acount = struct.unpack_from('<HHH', buf, b + 8)
            elements.append(strings[el] if el < len(strings) else '?')
            for a in range(acount):
                ap = b + astart + a * asize
                ni = struct.unpack_from('<I', buf, ap + 4)[0]
                attrs.append((strings[ni] if ni < len(strings) else '?',
                              resmap.get(ni), buf[ap + 15],
                              struct.unpack_from('<I', buf, ap + 16)[0]))
        pos += csize

    return strings, resmap, attrs, elements


def axml_value(dtype, data, strings):
    if dtype == 0x10:                                        # INT_DEC
        return str(struct.unpack('<i', struct.pack('<I', data))[0])
    if dtype == 0x12:                                        # BOOLEAN
        return 'true' if data else 'false'
    if dtype == 0x03:                                        # STRING
        return strings[data] if data < len(strings) else 'str#%d' % data
    if dtype == 0x01:                                        # REFERENCE
        return '@0x%08x' % data
    if dtype == 0x11:                                        # INT_HEX
        return '0x%x' % data
    return 'type=0x%02x' % dtype


# ---------------------------------------------------------------------------
# Проверки
# ---------------------------------------------------------------------------

def check_zip(path):
    print('\n=== 1. Структура ZIP ===')
    if not zipfile.is_zipfile(path):
        check('это ZIP-контейнер', False)
        return None
    z = zipfile.ZipFile(path)
    names = z.namelist()
    check('это ZIP-контейнер', True, '%d записей, %.1f КБ' % (len(names), os.path.getsize(path) / 1024))
    for required in ('AndroidManifest.xml', 'classes.dex', 'resources.arsc'):
        check('обязательная часть %s' % required, required in names)
    check('битый ZIP (testzip)', z.testzip() is None)
    return z


def check_signature(path):
    print('\n=== 2. Подпись ===')
    data = open(path, 'rb').read()
    eocd = data.rfind(b'PK\x05\x06')
    if eocd < 0:
        check('найден EOCD', False)
        return
    cd_off = struct.unpack_from('<I', data, eocd + 16)[0]
    magic_off = cd_off - 16
    has_block = data[magic_off:cd_off] == b'APK Sig Block 42'
    check('APK Signing Block присутствует', has_block)
    if not has_block:
        return

    size = struct.unpack_from('<Q', data, magic_off - 8)[0]
    start, end = cd_off - size - 8, magic_off - 8
    schemes, cert = [], None
    p = start + 8
    while p < end:
        pair_len = struct.unpack_from('<Q', data, p)[0]
        pid = struct.unpack_from('<I', data, p + 8)[0]
        if pid == 0x7109871a:
            schemes.append('v2')
            body = data[p + 12:p + 8 + pair_len]
            i = body.find(b'\x30\x82')
            if i >= 0:                                       # DER-сертификат X.509
                ln = struct.unpack_from('>H', body, i + 2)[0] + 4
                cert = body[i:i + ln]
        elif pid == 0xf05368c0:
            schemes.append('v3')
        p += 8 + pair_len

    check('схема подписи v2/v3', bool(schemes), ' '.join(schemes))
    if cert:
        is_debug = b'Android Debug' in cert
        check('сертификат извлечён', True,
              '%d b, SHA-256 %s…' % (len(cert), hashlib.sha256(cert).hexdigest()[:16]))
        check('это debug-сертификат (ожидается для debug-сборки)', is_debug)


def check_manifest(z):
    print('\n=== 3. AndroidManifest.xml ===')
    strings, _resmap, attrs, elements = parse_axml(z.read('AndroidManifest.xml'))
    print('  иерархия: %s' % ' > '.join(elements))
    a = {}
    for name, _rid, dtype, data in attrs:
        a.setdefault(name, axml_value(dtype, data, strings))

    for key, want in [('package', 'com.jorkyer.progcalc'),
                      ('versionName', '1.0'),
                      ('minSdkVersion', '24'),
                      ('targetSdkVersion', '34'),
                      ('debuggable', 'true'),
                      ('exported', 'true')]:
        check('%s = %s' % (key, want), a.get(key) == want, 'фактически: %s' % a.get(key))

    check('launcher-activity', a.get('name') == 'com.jorkyer.progcalc.MainActivity',
          a.get('name', '—'))
    check('intent-filter MAIN', 'android.intent.action.MAIN' in
          [axml_value(dt, d, strings) for _n, _r, dt, d in attrs])
    check('intent-filter LAUNCHER', 'android.intent.category.LAUNCHER' in
          [axml_value(dt, d, strings) for _n, _r, dt, d in attrs])
    check('label приложения — ссылка на ресурс', a.get('label', '').startswith('@0x'))
    check('иконка — ссылка на ресурс', a.get('icon', '').startswith('@0x'))


def check_dex(z):
    print('\n=== 4. Код обёртки в dex ===')
    dex = b''.join(z.read(n) for n in z.namelist() if n.endswith('.dex'))
    for marker in DEX_MARKERS:
        check(marker.decode(), marker in dex)


def check_assets(z):
    print('\n=== 5. Ассеты vs исходники ===')
    for asset, source in ASSETS:
        src_path = os.path.join(REPO_ROOT, source)
        if asset not in z.namelist():
            check('%s в APK' % asset, False)
            continue
        if not os.path.exists(src_path):
            check('%s (нет исходника %s)' % (asset, source), False)
            continue
        same = (hashlib.sha256(z.read(asset)).hexdigest() ==
                hashlib.sha256(open(src_path, 'rb').read()).hexdigest())
        check('%s = %s' % (asset, source), same,
              '' if same else 'содержимое расходится')

    arsc = z.read('resources.arsc')
    for text in ('Программируемый калькулятор', 'Theme.ProgCalc', 'ic_launcher'):
        needle = text.encode('utf-16-le')
        check('в ресурсах есть «%s»' % text, needle in arsc or text.encode() in arsc)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_APK
    if not os.path.exists(path):
        print('APK не найден: %s' % path)
        return 1

    print('Проверяем %s' % path)
    print('SHA-256: %s' % hashlib.sha256(open(path, 'rb').read()).hexdigest())

    z = check_zip(path)
    if z is None:
        return 1
    check_signature(path)
    check_manifest(z)
    check_dex(z)
    check_assets(z)

    print('\nИтог: %d проверок пройдено, %d провалено' % (ok_count, fail_count))
    return 1 if fail_count else 0


if __name__ == '__main__':
    sys.exit(main())
