const { VuetifyPlugin } = require('webpack-plugin-vuetify');
const { defineConfig } = require("@vue/cli-service")

module.exports = defineConfig({
  publicPath: "./",

  // Source maps would publish the full source and local paths (audit E4).
  productionSourceMap: false,

  configureWebpack: {
    plugins: [
      new VuetifyPlugin()
    ],
    module: {
      rules: [
        {
          test: /\.csv/,
          type: "asset/source"
        }
      ]
    }
  },

  devServer: {
    // BrowserStack/Safari testing needs the host check off, which is a
    // DNS-rebinding risk on shared networks, so it's opt-in per run:
    //   ALLOW_ALL_HOSTS=1 yarn serve      (audit E17)
    allowedHosts: process.env.ALLOW_ALL_HOSTS ? 'all' : 'auto',
    client: {
      overlay: false
    }
  }
});
