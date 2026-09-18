import { Platform } from 'react-native';
import {
  FontWeight, PaintStyle, Skia, TextAlign,
  type SkCanvas, type SkPaint, type SkParagraph,
} from '@shopify/react-native-skia';
import { DOT_RADIUS, NUMBER_RADIUS, type MonthPageLayout } from './monthLayout';

// Draws a laid-out month page (see monthLayout.ts) onto a Skia canvas. This is
// the only place that touches Skia's drawing API; everything about where things
// go was already decided by layoutMonthPage, so this is a loop over shapes.

export interface MonthPalette {
  tile: string;
  primary: string;
  text: string;
  textTertiary: string;
}

const TILE_RADIUS = 10;
const BAR_RADIUS = 3;
const BAR_TEXT_PADDING = 3;
const TODAY_RING = 1.5;
const BAR_FONT_SIZE = 9;
const NUMBER_FONT_SIZE = 14;

// Paragraph text rather than plain drawText: it shapes complex scripts and falls
// back to a colour-emoji font for glyphs the main font lacks, and gives a
// one-line ellipsis for free. Event titles are arbitrary user text.
const FAMILIES = Platform.select({
  ios: ['Helvetica Neue', 'Apple Color Emoji'],
  default: ['sans-serif', 'Noto Color Emoji'],
}) as string[];

const CACHE_LIMIT = 400;

const paints = new Map<string, SkPaint>();
function fillPaint(color: string): SkPaint {
  let paint = paints.get(color);
  if (!paint) {
    if (paints.size >= CACHE_LIMIT) paints.clear();
    paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(Skia.Color(color));
    paints.set(color, paint);
  }
  return paint;
}

let ringPaintKey = '';
let ringPaint: SkPaint | null = null;
function strokePaint(color: string): SkPaint {
  if (!ringPaint || ringPaintKey !== color) {
    ringPaint = Skia.Paint();
    ringPaint.setAntiAlias(true);
    ringPaint.setStyle(PaintStyle.Stroke);
    ringPaint.setStrokeWidth(TODAY_RING);
    ringPaint.setColor(Skia.Color(color));
    ringPaintKey = color;
  }
  return ringPaint;
}

// Laid-out paragraphs are immutable, so the same title/number can be painted
// again at any position without rebuilding it. Keyed by everything that
// affects how it looks.
const paragraphs = new Map<string, SkParagraph>();
function paragraph(
  text: string, color: string, size: number, weight: FontWeight, align: TextAlign, width: number,
): SkParagraph {
  const key = `${text}|${color}|${size}|${weight}|${align}|${width}`;
  let p = paragraphs.get(key);
  if (!p) {
    if (paragraphs.size >= CACHE_LIMIT) paragraphs.clear();
    const builder = Skia.ParagraphBuilder.Make({ maxLines: 1, ellipsis: '…', textAlign: align });
    builder.pushStyle({
      color: Skia.Color(color),
      fontSize: size,
      fontFamilies: FAMILIES,
      fontStyle: { weight },
    });
    builder.addText(text);
    p = builder.build();
    p.layout(width);
    paragraphs.set(key, p);
  }
  return p;
}

export function clearMonthDrawCaches(): void {
  paints.clear();
  paragraphs.clear();
  ringPaint = null;
  ringPaintKey = '';
}

export function drawMonthPage(canvas: SkCanvas, layout: MonthPageLayout, palette: MonthPalette): void {
  const tilePaint = fillPaint(palette.tile);
  for (const t of layout.tiles) {
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(t.x, t.y, t.w, t.h), TILE_RADIUS, TILE_RADIUS), tilePaint);
  }

  const diameter = NUMBER_RADIUS * 2;
  for (const n of layout.numbers) {
    if (n.today) canvas.drawCircle(n.cx, n.cy, NUMBER_RADIUS - TODAY_RING / 2, strokePaint(palette.primary));
    const p = paragraph(
      n.text,
      n.today ? palette.primary : palette.text,
      NUMBER_FONT_SIZE,
      n.today ? FontWeight.Bold : FontWeight.Normal,
      TextAlign.Center,
      diameter,
    );
    p.paint(canvas, n.cx - NUMBER_RADIUS, n.cy - p.getHeight() / 2);
  }

  for (const d of layout.dots) canvas.drawCircle(d.cx, d.cy, DOT_RADIUS, fillPaint(d.color));

  for (const b of layout.bars) {
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), BAR_RADIUS, BAR_RADIUS), fillPaint(b.color));
    const textWidth = Math.max(0, b.w - 2 * BAR_TEXT_PADDING);
    const p = paragraph(b.label, b.textColor, BAR_FONT_SIZE, FontWeight.SemiBold, TextAlign.Left, textWidth);
    p.paint(canvas, b.x + BAR_TEXT_PADDING, b.y + (b.h - p.getHeight()) / 2);
  }

  for (const o of layout.overflows) {
    const p = paragraph(o.text, palette.textTertiary, BAR_FONT_SIZE, FontWeight.SemiBold, TextAlign.Center, o.w);
    p.paint(canvas, o.x, o.y + (o.h - p.getHeight()) / 2);
  }
}
