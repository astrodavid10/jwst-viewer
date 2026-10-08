import { createVuetify } from 'vuetify';

// Translations provided by Vuetify
import { en } from 'vuetify/locale';

// Styles
import 'vuetify/styles';

// The app renders only <v-app> from Vuetify and draws every icon with Font
// Awesome SVG, so no icon font is loaded (the Material Design Icons webfont
// added ~3.6 MB to dist; audit E5).
export default createVuetify({
  locale: {
    locale: 'en',
    fallback: 'en',
    messages: { en },
  },
  theme: {
    defaultTheme: 'dark',
  },
});
