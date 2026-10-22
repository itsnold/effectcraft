package io.github.itsnold.ecdroid;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;

/** Bounded, sequential bridge transfers. A failed write never looks like a finished export. */
final class ExportStore implements AutoCloseable {
    static final long MAX_BYTES = 512L * 1024 * 1024;
    static final int MAX_CHUNK = 192 * 1024;
    static final int MAX_PENDING = 4;
    record Export(File file, String name, String mime) {}
    private final File directory;
    private final Deque<Export> ready = new ArrayDeque<>();
    private Export receiving;
    private FileOutputStream output;
    private long expected;
    private long received;

    ExportStore(File directory) { this.directory = directory; }

    synchronized void begin(String name, String mime, long bytes) throws IOException {
        if (receiving != null) throw new IOException("Another transfer is still in progress");
        if (ready.size() >= MAX_PENDING) throw new IOException("Finish saving the pending exports first");
        if (bytes < 0 || bytes > MAX_BYTES) throw new IOException("Export exceeds the 512 MiB Android bridge limit");
        File file = File.createTempFile("export-", ".part", directory);
        try {
            output = new FileOutputStream(file);
        } catch (IOException e) {
            if (!file.delete()) file.deleteOnExit();
            throw e;
        }
        receiving = new Export(file, safeName(name), safeMime(mime));
        expected = bytes;
        received = 0;
    }

    synchronized void append(byte[] bytes) throws IOException {
        if (receiving == null || output == null) throw new IOException("No active export");
        if (bytes.length > MAX_CHUNK || bytes.length > expected - received) {
            throw new IOException("Invalid export chunk");
        }
        output.write(bytes);
        received += bytes.length;
    }

    synchronized void finish() throws IOException {
        if (receiving == null || output == null) throw new IOException("No active export");
        if (received != expected) throw new IOException("Incomplete export; original is still in the editor");
        output.close();
        output = null;
        ready.addLast(receiving);
        receiving = null;
    }

    synchronized Export peek() { return ready.peekFirst(); }
    synchronized void discardFirst() {
        Export e = ready.pollFirst();
        if (e != null && !e.file().delete()) e.file().deleteOnExit();
    }

    synchronized void abort() throws IOException {
        try {
            if (output != null) output.close();
        } finally {
            output = null;
            if (receiving != null && !receiving.file().delete()) receiving.file().deleteOnExit();
            receiving = null;
        }
    }

    @Override public synchronized void close() throws IOException {
        try { abort(); } finally { while (!ready.isEmpty()) discardFirst(); }
    }

    static String safeName(String name) {
        if (name == null) return "export.bin";
        String clean = name.replace('\\', '/');
        clean = clean.substring(clean.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "_");
        if (clean.trim().isEmpty() || clean.equals(".") || clean.equals("..")) return "export.bin";
        return clean.codePoints().limit(180).collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append).toString();
    }

    static String safeMime(String mime) {
        return mime != null && mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+") ? mime : "application/octet-stream";
    }
}
