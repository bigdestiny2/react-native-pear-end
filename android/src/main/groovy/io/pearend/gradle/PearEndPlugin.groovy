// PearEndPlugin — registers the Gradle tasks consumers' builds depend on.
//
// STATUS: SKELETON. The task implementations are the integration heart
// of this package — they encode the bare-link-rooting fix that's the #1
// reason this SDK exists. They land when the reference integration's
// pearpasteLinkBareAddons + pearpasteBundleBareWorklet sources arrive
// via the handover.

package io.pearend.gradle

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.tasks.Exec

class PearEndPlugin implements Plugin<Project> {

  void apply (Project project) {
    // Plugin extension — consumer configures via `pearEnd { ... }`.
    def extension = project.extensions.create('pearEnd', PearEndExtension)

    // Task: link Bare native addons into react-native-bare-kit's addons
    // directory. Rooted at the consumer's repo root (auto-detected) so
    // workspaces / monorepo layouts work correctly.
    project.tasks.register('pearEndLinkBareAddons', Exec) { task ->
      task.group = 'pear-end'
      task.description = 'Stage Bare native addons into react-native-bare-kit (via bare-link)'

      task.doFirst {
        // TODO(handover): port pearpasteLinkBareAddons from the reference
        // integration. Pseudocode:
        //
        //   def repoRoot = extension.root ?: autoDetectWorkspacesParent(project)
        //   def bareLink = new File(repoRoot, 'node_modules/.bin/bare-link')
        //   if (!bareLink.exists()) {
        //     throw new GradleException("bare-link not found at ${bareLink}")
        //   }
        //   def bareKitAddons = new File(project.rootProject.projectDir,
        //     '../node_modules/react-native-bare-kit/android/src/main/addons')
        //
        //   workingDir repoRoot
        //   commandLine bareLink.absolutePath, '.',
        //     '--host', 'android-arm64',
        //     '--host', 'android-arm',
        //     '--host', 'android-ia32',
        //     '--host', 'android-x64',
        //     '--out', bareKitAddons.absolutePath

        throw new GradleException(
          'pearEndLinkBareAddons: SKELETON — awaiting reference integration handover. ' +
          'See ARCHITECTURE.md for the design contract.'
        )
      }
    }

    // Task: bundle the Bare worklet via bare-pack --linked.
    project.tasks.register('pearEndBundleWorklet', Exec) { task ->
      task.group = 'pear-end'
      task.description = 'Compile the Bare worklet bundle via bare-pack --linked'

      task.doFirst {
        // TODO(handover): port pearpasteBundleBareWorklet from the
        // reference integration. Pseudocode:
        //
        //   def repoRoot = extension.root ?: autoDetectWorkspacesParent(project)
        //   def barePack = new File(repoRoot, 'node_modules/.bin/bare-pack')
        //   def worklet = new File(repoRoot, extension.workletEntry)
        //   def outBundle = new File(repoRoot, "mobile/backend/app.android.bundle.js")
        //
        //   workingDir repoRoot
        //   commandLine barePack.absolutePath, '--linked',
        //     '--host', 'android-arm64',
        //     '--host', 'android-arm',
        //     '--host', 'android-ia32',
        //     '--host', 'android-x64',
        //     '--out', outBundle.absolutePath,
        //     worklet.absolutePath

        throw new GradleException(
          'pearEndBundleWorklet: SKELETON — awaiting reference integration handover.'
        )
      }
    }

    // Wire both tasks to preBuild so a normal `./gradlew assemble` does
    // the right thing. Order matters: addons must be staged before the
    // bundle is built (bare-pack's --linked mode needs the addons
    // present to resolve them).
    project.afterEvaluate {
      def preBuild = project.tasks.findByName('preBuild')
      if (preBuild) {
        preBuild.dependsOn 'pearEndLinkBareAddons'
        preBuild.dependsOn 'pearEndBundleWorklet'
      }
    }
  }
}

class PearEndExtension {
  /**
   * Override the auto-detected workspaces root. Optional — leave null
   * to use the auto-detection which handles flat RN apps, npm workspaces,
   * and Yarn workspaces.
   */
  File root = null

  /**
   * Path to the Bare worklet entrypoint, relative to the workspaces root.
   * Required.
   */
  String workletEntry = null

  /**
   * Android ABIs to stage. Defaults to all four; override only if your
   * minimum API level lets you drop 32-bit, or you specifically want to
   * test a single ABI.
   */
  List<String> abis = ['android-arm64', 'android-arm', 'android-ia32', 'android-x64']
}
