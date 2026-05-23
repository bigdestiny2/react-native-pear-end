# react-native-pear-end iOS Pod.
#
# STATUS: SKELETON. The xcframework staging mechanism is the largest
# open question in this SDK (see ARCHITECTURE.md). This podspec is the
# stable shape — the inner logic will be filled in when we have a
# canonical answer to "how should iOS Bare addon xcframeworks ship?"

require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name             = 'react-native-pear-end'
  s.version          = package['version']
  s.summary          = package['description']
  s.homepage         = package['repository']['url']
  s.license          = package['license']
  s.author           = 'react-native-pear-end contributors'
  s.source           = { :git => package['repository']['url'], :tag => "v#{s.version}" }

  s.platforms        = { :ios => '13.0' }
  s.requires_arc     = true

  # The Swift glue that bridges RN's AppState → worklet lifecycle hooks.
  s.source_files     = 'PearEnd/**/*.{swift,h,m,mm}'

  # The host RN Bare runtime.
  s.dependency       'react-native-bare-kit'

  # XCFRAMEWORK STAGING — UNRESOLVED.
  #
  # Bare native addons (udx-native, sodium-native, rocksdb-native,
  # hypercore-crypto, fs-native-extensions, bare-crypto, bare-dns) ship
  # as .xcframework files. They need to land in the consumer's app
  # bundle. Three possible mechanisms (see ARCHITECTURE.md):
  #
  #   1. This Pod resolves them from node_modules/<addon>/ios/<name>.xcframework
  #      via a script_phase that rsyncs them into the consumer's project.
  #   2. Each addon ships its own CocoaPod that we depend on here.
  #   3. An ios/link.mjs equivalent of bare-link that generates them
  #      from prebuilds at install time.
  #
  # When the reference integration's handover arrives, we'll pick whichever
  # path their solution proves out.
  #
  # s.script_phase = {
  #   :name => 'Stage Bare addons',
  #   :script => '${PODS_TARGET_SRCROOT}/scripts/stage-addons.sh',
  #   :execution_position => :before_compile
  # }

  s.swift_version = '5.0'
end
