package hack.api;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import hack.data.*;
import hack.model.*;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Small JSON-only service; no second UI and no browser CORS bypass. */
public final class Server implements AutoCloseable {
    private static final Gson JSON=new GsonBuilder().serializeNulls().setStrictness(Strictness.STRICT).create();
    private static final int MAX_BODY=16384;
    private final HttpServer server;
    private final ExecutorService executor=Executors.newFixedThreadPool(4);
    public Server(ModelService service,int port,String token) throws IOException {
        server=HttpServer.create(new InetSocketAddress(port),64);
        server.setExecutor(executor);
        server.createContext("/",exchange->{
            try {
                String path=exchange.getRequestURI().getPath(),method=exchange.getRequestMethod();
                if(path.equals("/api/health")) {
                    if(!method.equals("GET")){exchange.getResponseHeaders().set("Allow","GET");send(exchange,405,Map.of("error","method_not_allowed"));return;}
                    send(exchange,200,Map.of("status","ready","modelId",service.metadata().modelId(),"modelUsed",service.metadata().modelUsed(),"syntheticTraining",service.metadata().syntheticTraining()));return;
                }
                if(!path.equals("/api/score")){send(exchange,404,Map.of("error","not_found"));return;}
                if(!method.equals("POST")){exchange.getResponseHeaders().set("Allow","POST");send(exchange,405,Map.of("error","method_not_allowed"));return;}
                if(token!=null&&!token.isBlank()&&!MessageDigest.isEqual(("Bearer "+token).getBytes(StandardCharsets.UTF_8),Optional.ofNullable(exchange.getRequestHeaders().getFirst("Authorization")).orElse("").getBytes(StandardCharsets.UTF_8))){send(exchange,401,Map.of("error","unauthorized"));return;}
                String contentType=Optional.ofNullable(exchange.getRequestHeaders().getFirst("Content-Type")).orElse("");
                if(!contentType.split(";",2)[0].trim().equalsIgnoreCase("application/json")){send(exchange,415,Map.of("error","application/json required"));return;}
                byte[] body=exchange.getRequestBody().readNBytes(MAX_BODY+1);
                if(body.length>MAX_BODY){send(exchange,413,Map.of("error","request_too_large"));return;}
                JsonElement input=JSON.fromJson(new String(body,StandardCharsets.UTF_8),JsonElement.class);
                if(input==null||!input.isJsonObject())throw new IllegalArgumentException("Expected a JSON company object");
                send(exchange,200,service.score(CompanyInput.parse(input.getAsJsonObject())));
            } catch(JsonParseException|IllegalArgumentException e){send(exchange,400,Map.of("error","invalid_input","message",Optional.ofNullable(e.getMessage()).orElse("Invalid JSON")));}
              catch(Exception e){System.err.println("Scoring request failed: "+e.getClass().getSimpleName());send(exchange,500,Map.of("error","scoring_failed"));}
            finally{exchange.close();}
        });
    }
    public void start(){server.start();}
    public int port(){return server.getAddress().getPort();}
    public void close(){server.stop(1);executor.shutdownNow();}
    private static void send(HttpExchange e,int status,Object value)throws IOException {
        byte[] bytes=JSON.toJson(value).getBytes(StandardCharsets.UTF_8);
        e.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");
        e.getResponseHeaders().set("Cache-Control","no-store");
        e.getResponseHeaders().set("X-Content-Type-Options","nosniff");
        e.sendResponseHeaders(status,bytes.length);e.getResponseBody().write(bytes);
    }
    public static void main(String[] args)throws Exception {
        Map<String,String> env=System.getenv();
        String token=env.get("MODEL_API_TOKEN"),file=env.get("MODEL_DATA_PATH");
        if("true".equals(env.get("REQUIRE_API_TOKEN"))&&(token==null||token.isBlank()))throw new IllegalArgumentException("MODEL_API_TOKEN is required");
        DataSource source=file!=null&&!file.isBlank()?new CsvDataSource(Path.of(file)):new SyntheticDataSource(4000,2015,2025,42);
        Trainer trainer=switch(env.getOrDefault("MODEL_TYPE","logistic")){case "logistic"->new LogisticRegression(1);case "gradient"->new GradientBoosting(GradientBoosting.Params.defaults());default->throw new IllegalArgumentException("MODEL_TYPE must be logistic or gradient");};
        System.out.println("Initializing structured model once at startup…");
        ModelService service=new ModelService(source,trainer);
        Server server=new Server(service,Integer.parseInt(env.getOrDefault("PORT","8080")),token);
        Runtime.getRuntime().addShutdownHook(new Thread(server::close));server.start();
        System.out.println("Ready on port "+server.port()+"; "+service.metadata().modelUsed()+"; training="+service.metadata().trainingSource());
    }
}
