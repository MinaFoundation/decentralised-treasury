import {
  RUNTIME_CONFIG_WINDOW_KEY,
  getRuntimeConfig,
} from "../lib/get-runtime-config";
import { serializeRuntimeConfig } from "../lib/serialize-runtime-config";

/**
 * Publishes the container's configuration to the browser, which is what lets a
 * single published image serve any deployment.
 *
 * Deliberately a raw inline `<script>` rendered into `<head>` rather than
 * `next/script`: a `beforeInteractive` script is carried in the RSC flight
 * payload and only runs at hydration, whereas modules such as the
 * endpoint-settings store read the config the moment their chunk evaluates. An
 * inline script parsed ahead of the bundle tags is the only placement that
 * reliably wins that race.
 *
 * Must stay in the root layout, and that layout must stay dynamic - a
 * statically rendered layout would bake the build machine's environment
 * straight back into the HTML.
 */
export function RuntimeConfigScript() {
  const serializedConfig = serializeRuntimeConfig(getRuntimeConfig());

  return (
    <script
      id="treasury-runtime-config"
      dangerouslySetInnerHTML={{
        __html: `window.${RUNTIME_CONFIG_WINDOW_KEY}=${serializedConfig};`,
      }}
    />
  );
}
