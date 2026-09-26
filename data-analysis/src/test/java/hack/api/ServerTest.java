package hack.api;

import com.google.gson.*;
import hack.data.SyntheticDataSource;
import hack.model.LogisticRegression;
import org.junit.jupiter.api.*;
import java.net.URI;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class ServerTest {
    static Server server;static String base;static final HttpClient CLIENT=HttpClient.newHttpClient();
    static final String FULL="""
      {"id":"company-1","year":2027,"sector":"Manufacturing","foundedYear":1998,"revenueK":24600,
       "employees":120,"ebitdaMargin":0.12,"leverage":0.4,"revenueGrowth3y":0.03,"maxDirectorTenure":20,
       "ownerAge":61,"familyOwned":true,"shareholders":2,"sectorDeals24m":15}
      """;
    @BeforeAll static void start()throws Exception{
        server=new Server(new ModelService(new SyntheticDataSource(1000,2015,2025,42),new LogisticRegression(1)),0,"test-token");
        server.start();base="http://localhost:"+server.port();
    }
    @AfterAll static void stop(){server.close();}
    static HttpResponse<String> request(String path,String method,String body,String token,String contentType)throws Exception{
        var b=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type",contentType);
        if(token!=null)b.header("Authorization","Bearer "+token);
        b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body));
        return CLIENT.send(b.build(),HttpResponse.BodyHandlers.ofString());
    }
    static HttpResponse<String> score(String body)throws Exception{return request("/api/score","POST",body,"test-token","application/json");}
    static JsonObject json(HttpResponse<String> response){return JsonParser.parseString(response.body()).getAsJsonObject();}
    @Test void healthAndScoreReuseOneModelAndExplainExactly()throws Exception{
        var health=json(request("/api/health","GET",null,null,"application/json"));
        var scored=score(FULL);assertEquals(200,scored.statusCode());var v=json(scored);
        assertEquals(health.get("modelId"),v.getAsJsonObject("metadata").get("modelId"));
        double p=v.get("probability").getAsDouble(),sum=v.get("baselineLogOdds").getAsDouble();
        for(var c:v.getAsJsonArray("contributions"))sum+=c.getAsJsonObject().get("logOdds").getAsDouble();
        assertEquals(p,1/(1+Math.exp(-sum)),1e-10);
        assertEquals(1,v.get("coverage").getAsDouble());
        assertTrue(v.getAsJsonObject("metadata").get("syntheticTraining").getAsBoolean());
        var tasks=new ArrayList<CompletableFuture<JsonObject>>();
        for(int i=0;i<8;i++)tasks.add(CompletableFuture.supplyAsync(()->{try{return json(score(FULL));}catch(Exception e){throw new RuntimeException(e);}}));
        for(var task:tasks){var repeated=task.get();assertEquals(v.get("probability"),repeated.get("probability"));assertEquals(v.get("metadata"),repeated.get("metadata"));}
    }
    @Test void missingBooleanAndIntegerFieldsStayMissing()throws Exception{
        var v=json(score("{\"id\":\"partial\",\"year\":2027,\"employees\":40,\"revenueK\":2000}"));
        assertEquals("Low",v.get("confidence").getAsString());assertEquals(2.0/11,v.get("coverage").getAsDouble(),1e-10);
        for(var c:v.getAsJsonArray("contributions")){var f=c.getAsJsonObject();if(List.of("familyOwned","firmAge","logShareholders").contains(f.get("feature").getAsString())){assertTrue(f.get("imputed").getAsBoolean());assertTrue(f.get("observedValue").isJsonNull());}}
        var empty=json(score("{\"id\":\"unknown\",\"year\":2027}"));
        assertEquals("insufficient_data",empty.get("status").getAsString());assertTrue(empty.get("probability").isJsonNull());
    }
    @Test void transportAndValidationFailuresAreJsonAndBounded()throws Exception{
        assertEquals(401,request("/api/score","POST",FULL,null,"application/json").statusCode());
        assertEquals(405,request("/api/score","GET",null,null,"application/json").statusCode());
        assertEquals(404,request("/api/score/extra","POST",FULL,"test-token","application/json").statusCode());
        assertEquals(415,request("/api/score","POST",FULL,"test-token","text/plain").statusCode());
        assertEquals(413,score(" ".repeat(17000)).statusCode());
        for(String bad:List.of("[]","null","{",FULL.replace("2027","2025"),FULL.replace("0.12","\"0.12\""),FULL.replace("\"familyOwned\":true","\"familyOwned\":0.2"),FULL.replace("\"ownerAge\":61","\"ownerAge\":161"),FULL.replace("\"employees\":120","\"employees\":1e999"),FULL.replace("\"sector\":","\"sold\":1,\"sector\":"))){var response=score(bad);assertEquals(400,response.statusCode(),bad);assertTrue(json(response).has("error"));}
    }
}
