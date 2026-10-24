package com.gathin.tvhome;

import android.animation.ValueAnimator;
import android.graphics.Bitmap;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.View;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

/** Draws the tvOS style lighter band behind the first (dock) row and adds a gap below it. */
public class DockDecoration extends RecyclerView.ItemDecoration {
    /** false: keep the dock's spacing but draw no band behind it (Apple TV layout). */
    private boolean drawBand = true;
    void setDrawBand(boolean on) { drawBand = on; }

    // ---- frosted glass (Apple TV mode) ----
    /**
     * The band is glass over the Top Shelf: the backdrop behind it, softened (setFrost gets a tiny copy
     * that is stretched back over the screen, which blurs it for free, with the white veil already painted
     * into it, MainActivity.frostOf). One fill of the band a frame; no live blur, which this TV's GPU can't
     * afford. With no picture behind it, the band is the veil alone.
     */
    private boolean frosted;
    private final Paint frostFrom = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint frostTo = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint veil = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Bitmap frostFromBitmap, frostToBitmap;
    private float frostMix = 1f;
    /** The glass's white veil: frost bitmaps have it painted in; drawn on its own only without one. */
    static final int VEIL = 0x4DFFFFFF;
    private ValueAnimator frostAnimator;
    private final Matrix frostMatrix = new Matrix();
    private final RectF frostSrc = new RectF(), frostDst = new RectF();
    private final int[] where = new int[2];

    void setFrosted(boolean on) {
        frosted = on;
        drawBand = true;
        veil.setColor(VEIL);
        edge.setColor(0x33FFFFFF);
    }

    /** The picture behind the dock now (null: none); crossfades from the last one like the backdrop does. */
    void setFrost(Bitmap next, RecyclerView parent, boolean animate) {
        if (next == frostToBitmap) return;
        if (frostAnimator != null) frostAnimator.cancel();
        frostFrom.setShader(frostTo.getShader());
        frostFromBitmap = frostToBitmap;
        frostToBitmap = next;
        frostTo.setShader(next == null ? null : new BitmapShader(next, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        if (!animate || frostFrom.getShader() == null) {
            frostMix = 1f;
            parent.invalidate();
            return;
        }
        frostMix = 0f;
        frostAnimator = ValueAnimator.ofFloat(0f, 1f).setDuration(600);
        frostAnimator.addUpdateListener(a -> {
            frostMix = (float) a.getAnimatedValue();
            parent.invalidate();
        });
        frostAnimator.start();
    }

    /** Maps a frost bitmap over the whole screen, in the grid's coordinates, so it lines up with the backdrop. */
    private void placeFrost(Paint paint, Bitmap bitmap, RecyclerView parent) {
        if (paint.getShader() == null || bitmap == null) return;
        parent.getLocationInWindow(where);
        View root = parent.getRootView();
        frostDst.set(-where[0], -where[1], root.getWidth() - where[0], root.getHeight() - where[1]);
        frostSrc.set(0, 0, bitmap.getWidth(), bitmap.getHeight());
        frostMatrix.setRectToRect(frostSrc, frostDst, Matrix.ScaleToFit.FILL);
        paint.getShader().setLocalMatrix(frostMatrix);
    }

    private void drawFrosted(Canvas c, RecyclerView parent, float radius) {
        if (frostFrom.getShader() != null && frostMix < 1f) {
            placeFrost(frostFrom, frostFromBitmap, parent);
            frostFrom.setAlpha(255);
            c.drawRoundRect(rect, radius, radius, frostFrom);
        }
        if (frostTo.getShader() != null) {
            placeFrost(frostTo, frostToBitmap, parent);
            frostTo.setAlpha(Math.round(255 * frostMix));
            c.drawRoundRect(rect, radius, radius, frostTo);
        } else {
            c.drawRoundRect(rect, radius, radius, veil);
        }
        c.drawRoundRect(rect, radius, radius, edge);
    }


    private final int dockSize;
    private final float density;
    private final Paint band = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();

    /** Extra band below the tiles for their names (always_show_names), in px. */
    private final float namesRoom;
    /** Light glass like the top bar's pills (config.xml dock_glass): a white tint that fades downwards. */
    private final boolean lightGlass;
    /** Padding all round the tiles equal to the gap between them (config.xml dock_even_padding). */
    private final boolean evenPadding;
    /** The band's top and bottom the glass gradient was made for; it is remade when they move. */
    private float shaderTop = Float.NaN, shaderBottom = Float.NaN;

    /**
     * @param translucent the cinematic shelf's band: the artwork and the glow show through it.
     * @param names       the dock tiles show their names, so the band reaches down over them.
     * @param opacity     the plain band's opacity in percent (dock_opacity), so a wallpaper can show through it.
     * @param lightGlass  a light frosted band like the pills, for a sky or wallpaper behind it.
     * @param evenPadding the band's padding is the gap between the tiles on all four sides (dock_even_padding).
     */
    DockDecoration(int dockSize, float density, boolean translucent, boolean names, int opacity, boolean lightGlass,
                   boolean evenPadding) {
        this.dockSize = dockSize;
        this.density = density;
        this.namesRoom = names ? 22 * density : 0;
        this.lightGlass = lightGlass;
        this.evenPadding = evenPadding;
        band.setColor(translucent ? 0x8C121014 : (Math.round(opacity * 2.55f) << 24) | 0x141416);
        edge.setStyle(Paint.Style.STROKE);
        edge.setStrokeWidth(density);
        edge.setColor(lightGlass ? 0x38FFFFFF : translucent ? 0x26FFFFFF : 0x1FFFFFFF);
    }

    /** Concentric corners: the band's radius is the tiles' radius plus the band's padding around them. */
    static float radiusPx(float tileRadiusPx, float paddingPx) {
        return tileRadiusPx + paddingPx;
    }

    /**
     * The band's padding on every side for dock_even_padding: the gap between two dock tiles (a cell minus its tile, as
     * AppAdapter.tileWidthPx lays them out), capped by the room the grid leaves at its edges.
     */
    static float evenPaddingPx(int innerWidthPx, int columns, int tileWidthPx, float roomPx) {
        float gap = columns > 0 ? innerWidthPx / (float) columns - tileWidthPx : 0f;
        return Math.max(0f, Math.min(gap, roomPx));
    }

    @Override
    public void getItemOffsets(@NonNull Rect outRect, @NonNull View view, @NonNull RecyclerView parent,
                               @NonNull RecyclerView.State state) {
        int pos = parent.getChildAdapterPosition(view);
        if (pos >= 0 && pos < dockSize) {
            outRect.top = (int) (6 * density);
            outRect.bottom = (int) (12 * density);
        }
    }

    @Override
    public void onDraw(@NonNull Canvas c, @NonNull RecyclerView parent, @NonNull RecyclerView.State state) {
        if (!drawBand) return;
        boolean any = false;
        int cardWidth = 0;
        for (int i = 0; i < parent.getChildCount(); i++) {
            View child = parent.getChildAt(i);
            int pos = parent.getChildAdapterPosition(child);
            if (pos < 0 || pos >= dockSize) continue;
            RecyclerView.ViewHolder vh = parent.getChildViewHolder(child);
            View card = vh instanceof AppAdapter.Holder ? ((AppAdapter.Holder) vh).card : child.findViewById(R.id.card);
            if (card == null) continue;
            float l = child.getLeft() + card.getLeft();
            float t = child.getTop() + card.getTop() + child.getTranslationY();
            float r = l + card.getWidth();
            float b = t + card.getHeight();
            cardWidth = card.getWidth();
            if (!any) {
                rect.set(l, t, r, b);
                any = true;
            } else {
                rect.union(l, t, r, b);
            }
        }
        if (!any) return;
        float pad = 14 * density;
        // The band can only draw inside the grid, and the first and last dock tiles sit 12dp in from its
        // edges: a full 14dp at the sides sliced the rounded ends flat (#454). Keep the sides, with the
        // 1dp edge line, inside the grid; the top and bottom have room.
        // 22dp at the sides (the grid's 10dp padding makes room): a focused first or last tile grows about 7dp
        // outwards and still keeps about the band's top margin from its rounded end.
        float sidePad = 22 * density;
        float side = Math.max(0f, Math.min(sidePad, Math.min(rect.left, parent.getWidth() - rect.right) - density));
        float radius = AppAdapter.cornerRadius(cardWidth, density);
        if (evenPadding || frosted) {
            // The same padding on all four sides, so the band's corners are concentric with the tiles' everywhere.
            int inner = parent.getWidth() - parent.getPaddingLeft() - parent.getPaddingRight();
            float room = Math.min(rect.top, Math.min(rect.left, parent.getWidth() - rect.right)) - density;
            float even = evenPaddingPx(inner, dockSize, cardWidth, room);
            rect.inset(-even, -even);
            radius = radiusPx(radius, even);
        } else {
            // dock_even_padding off: the band as before, with its fixed 26 dp corners.
            rect.inset(-side, -pad);
            radius = 26 * density;
        }
        rect.bottom += namesRoom;
        if (frosted) {
            drawFrosted(c, parent, radius);
            return;
        }
        if (lightGlass && (rect.top != shaderTop || rect.bottom != shaderBottom)) {
            // The pills' glass (pill_bg: white, 18% fading to 8%), a little fainter over this much larger area.
            band.setShader(new LinearGradient(0, rect.top, 0, rect.bottom, 0x24FFFFFF, 0x0DFFFFFF,
                    Shader.TileMode.CLAMP));
            shaderTop = rect.top;
            shaderBottom = rect.bottom;
        }
        c.drawRoundRect(rect, radius, radius, band);
        c.drawRoundRect(rect, radius, radius, edge);
    }
}
