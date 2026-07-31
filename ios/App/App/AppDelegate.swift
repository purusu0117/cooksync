import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // ⚠️ 以前ここに clearWebCache() があり、起動時とバックグラウンド移行時に
    //    WKWebsiteDataStore（DiskCache / MemoryCache / OfflineWebApplicationCache）と
    //    URLCache.shared を毎回まるごと消していた。
    //
    //    入れた理由（d07e7c8）は「remote URL 方式だと古いWebが残って更新が届かない」。
    //    それ自体は当時は正しい対処だったが、オフライン対応を入れた今は逆効果だった:
    //      - 端末に残っているキャッシュを毎回捨てるので、圏外で起動したときに
    //        表示できるものが何も無くなる（＝真っ黒）。
    //      - バックグラウンド移行のたびに消すため、そのセッションで温まった
    //        キャッシュがアプリを切り替えるたびに全部無効になり、通信量も増える。
    //
    //    「常に最新」の役目は Service Worker（public/sw.js）が引き継いだ。
    //    画面遷移はネットワーク優先＝オンラインなら必ず最新HTMLを取り、
    //    失敗したときだけキャッシュを出す。/_next/static/* は内容が変わればURLも変わるので
    //    古いものが使われることはない。つまり全消しは不要になったうえ、
    //    オフライン対応と真正面からぶつかるので撤去した。
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // APNs（サーバーからのプッシュ通知）のトークン受信を Capacitor の PushNotifications プラグインへ転送する。
    // これが無いと register() を呼んでも 'registration' イベントが発火せず、端末トークンが取れない
    // （＝タイマー完了やレシピ探索完了の通知が一切届かない）。CashSyncで実際に踏んだ落とし穴。
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
