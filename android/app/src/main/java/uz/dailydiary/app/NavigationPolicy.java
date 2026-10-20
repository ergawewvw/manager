package uz.dailydiary.app;

import java.net.URI;

final class NavigationPolicy {
    static final String ORIGIN = "https://ergawewvw.github.io";
    static final String HOME = ORIGIN + "/manager/?app=android&v=20261020f";
    static boolean trusted(String url) {
        try {
            URI uri = new URI(url);
            String path = uri.normalize().getPath();
            return "https".equals(uri.getScheme()) && "ergawewvw.github.io".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null
                && ("/manager".equals(path) || "/manager/".equals(path)
                    || "/manager/index.html".equals(path) || "/manager/visitor.html".equals(path)
                    || "/manager/sharing.html".equals(path) || "/manager/admin.html".equals(path));
        } catch (Exception ignored) { return false; }
    }
}
