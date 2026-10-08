#!/usr/bin/env python3
"""
Genera le icone della web app InDubai dal marchio del brand.

    python3 scripts/make-icons.py        # dalla root del repo

Sorgente: client-portal/assets/icon-app.png — la "In" con il Burj Khalifa,
bianca su nero, gia' usata dall'app iOS nativa e dal portale cliente.

Le icone sono quadrate, a pieno campo e senza trasparenza: iOS e Android
applicano da soli la loro maschera (squircle, cerchio, goccia...). Le vecchie
icone erano un cerchio con gli angoli trasparenti e nessun marchio sopra, per
questo nel dock apparivano come una macchia scura senza forma.

Se cambi le icone ricordati di alzare il ?v=N nei manifest e nei tag
<link rel="apple-touch-icon">: le app gia' installate tengono in cache
l'icona per URL, e senza un URL nuovo continuano a mostrare la vecchia.
"""
from PIL import Image

SRC = 'client-portal/assets/icon-app.png'
BG = (0, 0, 0)            # nero del brand
FG = (255, 255, 255)      # bianco del marchio

# Soglie per ricavare la maschera dal sorgente, che e' un JPEG: il nero non e'
# perfettamente piatto e i bordi del marchio sono antialiasati.
LO, HI = 40, 200

# Altezza del marchio in frazione del lato.
H_NORMAL = 0.66    # come nel marchio originale
H_MASKABLE = 0.50  # entra nella safe zone di Android (cerchio centrale all'80%)
H_FAVICON = 0.76   # a 16-32px serve piu' grande, o la guglia sparisce


def load_mark():
    """Maschera alpha del solo marchio, ritagliata al suo bounding box."""
    g = Image.open(SRC).convert('L')
    alpha = g.point(lambda v: 0 if v <= LO else 255 if v >= HI
                    else round((v - LO) * 255 / (HI - LO)))
    return alpha.crop(alpha.getbbox())


def build(size, mark, height_ratio):
    """Icona quadrata opaca col marchio centrato."""
    canvas = Image.new('RGB', (size, size), BG)
    h = round(size * height_ratio)
    w = round(mark.width * h / mark.height)
    canvas.paste(Image.new('RGB', (w, h), FG),
                 ((size - w) // 2, (size - h) // 2),
                 mark.resize((w, h), Image.LANCZOS))
    return canvas


def main():
    mark = load_mark()
    print(f'marchio: {mark.width}x{mark.height}')

    for size in (192, 512, 1024):
        build(size, mark, H_NORMAL).save(f'img/icon-{size}.png', optimize=True)
    for size in (192, 512):
        build(size, mark, H_MASKABLE).save(f'img/icon-{size}-maskable.png', optimize=True)

    build(180, mark, H_NORMAL).save('img/apple-touch-icon.png', optimize=True)

    build(256, mark, H_FAVICON).save(
        'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    build(32, mark, H_FAVICON).save('img/favicon-32.png', optimize=True)

    print('icone rigenerate in img/ e favicon.ico')


if __name__ == '__main__':
    main()
