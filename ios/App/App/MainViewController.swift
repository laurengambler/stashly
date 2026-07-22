//
//  MainViewController.swift
//  Stashly
//
//  Capacitor auto-registers plugins that ship as SPM/CocoaPods packages,
//  but NOT plugins defined locally in the app target. StashScannerPlugin
//  lives in the app, so we register it explicitly here — the official hook
//  is CAPBridgeViewController.capacitorDidLoad().
//
//  Main.storyboard's root view controller is set to this class
//  (customClass = MainViewController, module = Get_Stashly).
//

import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(StashScannerPlugin())
    }
}
