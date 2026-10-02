import { isLiquidGlassAvailable } from "expo-glass-effect";

/**
 * Whether to draw real glass.
 *
 * Read once, at module load: it reports whether the binary was built against
 * an SDK that ships Liquid Glass, which cannot change while the app is running.
 *
 * Deliberately *not* a hook, and deliberately not checking Reduce Transparency.
 * An earlier version resolved that setting asynchronously, which meant the
 * first frame drew real glass and a later frame tore it down for the flat
 * fallback — glass that appeared and then vanished. UIKit already degrades its
 * own material when the user asks for less transparency, so there was nothing
 * to second-guess, and nothing worth a swap mid-render.
 */
export const HAS_GLASS = isLiquidGlassAvailable();
