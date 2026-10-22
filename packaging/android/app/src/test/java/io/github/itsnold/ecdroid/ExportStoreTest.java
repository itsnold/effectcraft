package io.github.itsnold.ecdroid;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public final class ExportStoreTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    @Test public void exactChunksRoundTripAndCleanup() throws Exception {
        try (ExportStore store = new ExportStore(temp.getRoot())) {
            store.begin("../../test.ecproj", "application/json", 5);
            store.append(new byte[]{1, 2});
            store.append(new byte[]{3, 4, 5});
            store.finish();
            assertEquals("test.ecproj", store.peek().name());
            assertArrayEquals(new byte[]{1, 2, 3, 4, 5}, Files.readAllBytes(store.peek().file().toPath()));
            File file = store.peek().file();
            store.discardFirst();
            assertFalse(file.exists());
        }
    }

    @Test public void incompleteAndOversizedExportsAreNotQueued() throws Exception {
        try (ExportStore store = new ExportStore(temp.getRoot())) {
            assertThrows(IOException.class, () -> store.begin("a", "x/y", -1));
            assertThrows(IOException.class, () -> store.begin("a", "x/y", ExportStore.MAX_BYTES + 1));
            store.begin("a", "x/y", 4);
            store.append(new byte[]{1});
            assertThrows(IOException.class, store::finish);
            assertNull(store.peek());
            assertThrows(IOException.class, () -> store.append(new byte[4]));
            store.abort();
            assertEquals(0, temp.getRoot().list().length);
            store.begin("b", "x/y", 0);
            store.finish();
            assertEquals(0, store.peek().file().length());
        }
    }

    @Test public void onlyBoundedSequentialTransfersAreAccepted() throws Exception {
        try (ExportStore store = new ExportStore(temp.getRoot())) {
            assertThrows(IOException.class, () -> store.append(new byte[0]));
            assertThrows(IOException.class, store::finish);
            store.begin("a", "x/y", ExportStore.MAX_CHUNK + 1);
            assertThrows(IOException.class, () -> store.append(new byte[ExportStore.MAX_CHUNK + 1]));
            assertThrows(IOException.class, () -> store.begin("b", "x/y", 0));
            store.abort();
            for (int i = 0; i < ExportStore.MAX_PENDING; i++) { store.begin("a", "x/y", 0); store.finish(); }
            assertThrows(IOException.class, () -> store.begin("a", "x/y", 0));
        }
    }

    @Test public void namesAndMimeCannotEscapeThePicker() {
        assertEquals("export.bin", ExportStore.safeName(".."));
        assertEquals("export.bin", ExportStore.safeName(null));
        assertEquals("render.mp4", ExportStore.safeName("C:\\dir\\render.mp4"));
        assertEquals("line_name", ExportStore.safeName("line\nname"));
        assertEquals("application/octet-stream", ExportStore.safeMime("video/mp4\r\nBad: value"));
        assertEquals("image/png", ExportStore.safeMime("image/png"));
    }
}
