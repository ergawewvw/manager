package uz.dailydiary.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class NavigationPolicyTest {
    @Test public void acceptsDiaryPagesAndFragments() {
        assertTrue(NavigationPolicy.trusted(NavigationPolicy.HOME));
        assertTrue(NavigationPolicy.trusted("https://ergawewvw.github.io/manager/visitor.html"));
        assertTrue(NavigationPolicy.trusted("https://ergawewvw.github.io:443/manager/index.html#access_token=fixture"));
    }
    @Test public void blocksOriginConfusionAndLocalSchemes() {
        for (String url : new String[]{"http://ergawewvw.github.io/manager/", "https://ergawewvw.github.io.evil.test/manager/",
            "https://ergawewvw.github.io@evil.test/manager/", "https://ergawewvw.github.io:444/manager/",
            "https://ergawewvw.github.io/other/", "https://ergawewvw.github.io/manager/../other/",
            "https://ergawewvw.github.io/manager/%2e%2e/other/", "file:///manager/", "javascript:alert(1)", "data:text/html,hello", "intent://manager/"}) assertFalse(url, NavigationPolicy.trusted(url));
    }
}
