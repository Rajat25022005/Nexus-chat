from app.embeddings.embedder import Embedder

embedder = Embedder()

text1 = "The login bug was caused by token expiration"
text2 = "JWT tokens were expiring too early"

v1 = embedder.embed(text1)
v2 = embedder.embed(text2)

print(len(v1))
print(v1[:5])
