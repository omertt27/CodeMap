package com.example.app;

import com.example.lib.Helper;
import java.util.List;

public class Server {
  private Helper helper;
  public void start() { helper.run(); }
  public int calc(int x) { return x * 2; }
}
